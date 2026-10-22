/**
 * 活动理解层（v1.94）—— 把「他前台开了哪些窗口」归纳成「她理解的他在干什么」。
 *
 * 设计原则：
 *   · **确定性**：纯规则关键词 + 计数/时长聚合，不调模型 ⇒ 不会编造、结果可解释、可测；
 *   · **只说能证明的**：没有匹配 ⇒ 明说"看不出具体在做什么"，不硬猜；
 *   · **给她的是一句"理解" + 证据**，不是让她背的台词（她可以自己接话）；
 *   · 隐私一致：只读采样器给的窗口标题/进程（已脱敏），不读内容、不截屏。
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ActivityView } from './activityWatcher.js';

export type ActivityCategory =
  | 'job' | 'dev' | 'video' | 'music' | 'chat' | 'doc' | 'study'
  | 'meeting' | 'shopping' | 'gaming' | 'browsing' | 'unknown';

interface CategoryDef {
  key: ActivityCategory;
  label: string;
  /** 用第一人称"你"对她说话的一句理解（偏中性，情绪由她的状态决定） */
  summary: string;
  keywords: string[];
}

/** 关键词表：顺序即优先级（先匹配到的类别优先），只用"标题里出现就算"的硬证据 */
export const ACTIVITY_KEYWORDS: CategoryDef[] = [
  { key: 'job', label: '找工作', summary: '你像是在看工作机会', keywords: ['招聘', 'boss直聘', '拉勾', '智联', '前程无忧', '猎聘', '求职', '岗位', '面试', '简历', '实习', 'offer'] },
  { key: 'meeting', label: '开会', summary: '你像是在开会', keywords: ['腾讯会议', '钉钉会议', 'zoom', 'teams', '飞书会议', '会议', 'meeting'] },
  { key: 'dev', label: '写代码', summary: '你在写代码/弄项目', keywords: ['visual studio', 'vscode', 'idea', 'pycharm', 'webstorm', 'git', 'github', 'gitlab', '终端', 'terminal', 'powershell', 'cmd.exe', 'docker', 'localhost', 'devtools', 'harness'] },
  { key: 'study', label: '学习', summary: '你在学东西', keywords: ['教程', '课程', '网课', '文档', 'documentation', 'wiki', '知乎', 'csdn', 'stack overflow', 'paper', '论文', '讲义'] },
  { key: 'video', label: '看视频', summary: '你在刷视频', keywords: ['youtube', 'bilibili', '哔哩哔哩', '抖音', '腾讯视频', '爱奇艺', '优酷', 'netflix', '视频'] },
  { key: 'music', label: '听歌', summary: '你在听歌', keywords: ['网易云', 'qq音乐', 'spotify', '酷狗', '音乐', 'music'] },
  { key: 'chat', label: '聊天', summary: '你在跟人聊天', keywords: ['微信', 'wechat', 'qq', 'telegram', 'discord', 'slack', '飞书', '钉钉', 'whatsapp'] },
  { key: 'shopping', label: '逛购物', summary: '你在逛购物网站', keywords: ['淘宝', '天猫', '京东', '拼多多', '亚马逊', 'amazon', '闲鱼', '购物'] },
  { key: 'gaming', label: '玩游戏', summary: '你在玩游戏', keywords: ['steam', 'epic games', '游戏', 'game', '原神', '英雄联盟'] },
  { key: 'doc', label: '看文档/写东西', summary: '你在看文档或写东西', keywords: ['word', 'excel', 'powerpoint', 'wps', 'notion', 'obsidian', 'typora', 'pdf', '简历模板', 'docs'] },
  { key: 'browsing', label: '随便逛', summary: '你在随便逛网页', keywords: ['chrome', 'edge', 'firefox', 'safari', '浏览器'] },
];

export interface ActivityCategoryHit {
  key: ActivityCategory;
  label: string;
  count: number;
  /** 占参与统计的窗口条数比例（0~1） */
  share: number;
}

export interface ActivityUnderstanding {
  /** 一句"她的理解"（第一人称对你说） */
  summary: string;
  /** 主导类别的标签（没有就 unknown） */
  category: ActivityCategory;
  label: string;
  /** 置信度：主导类别占参与统计窗口的比例（0~1） */
  confidence: number;
  /** 统计窗口：多少条窗口、跨多少分钟 */
  windows: number;
  spanMinutes: number;
  /** 各类别命中数（按命中数降序，最多 4 个） */
  categories: ActivityCategoryHit[];
  /** 支撑这句理解的具体窗口标题（最多 3 条，给界面/她引用） */
  evidence: string[];
  /** 是不是"看不出具体"（无匹配 / 记录太少） */
  vague: boolean;
}

const MAX_EVIDENCE = 3;
const MIN_CONFIDENT_WINDOWS = 2;

// ===== v1.95 关键词表可配置（activity-keywords.json；不写就用内置默认） =====

export const ACTIVITY_KEYWORDS_PATH = 'activity-keywords.json';

let cachedTable: CategoryDef[] | null = null;
let cachedMtime = -1;

/**
 * 读取关键词表：内置默认 + activity-keywords.json 的覆盖。
 * 同一类别写了 keywords 就**整类替换**（不是追加），方便用户完全接管。
 * 文件不存在 / 解析失败 ⇒ 用默认表，不抛错。
 */
export function loadKeywordTable(path = ACTIVITY_KEYWORDS_PATH): CategoryDef[] {
  try {
    if (!existsSync(path)) return ACTIVITY_KEYWORDS;
    const mtime = statSync(path).mtimeMs;
    if (cachedTable && cachedMtime === mtime) return cachedTable;
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { categories?: Record<string, { keywords?: unknown }> };
    const cats = raw && typeof raw === 'object' && raw.categories && typeof raw.categories === 'object' ? raw.categories : {};
    const table = ACTIVITY_KEYWORDS.map(def => {
      const override = cats[def.key];
      if (!override || !Array.isArray(override.keywords)) return def;
      const words = override.keywords.map(w => String(w ?? '').trim()).filter(w => w.length > 0).slice(0, 80);
      return words.length > 0 ? { ...def, keywords: words } : def;
    });
    cachedTable = table;
    cachedMtime = mtime;
    return table;
  } catch {
    return ACTIVITY_KEYWORDS;
  }
}

/** 测试/热更新用：清掉关键词表缓存 */
export function resetKeywordTableCacheForTests(): void {
  cachedTable = null;
  cachedMtime = -1;
}

/** 把一条窗口标题/进程归到类别（按关键词表顺序，先命中先算） */
export function classifyActivity(title: string, processName?: string, table: CategoryDef[] = loadKeywordTable()): ActivityCategory | null {
  const hay = `${title ?? ''} ${processName ?? ''}`.toLowerCase();
  if (!hay.trim()) return null;
  for (const def of table) {
    for (const kw of def.keywords) {
      if (hay.includes(kw.toLowerCase())) return def.key;
    }
  }
  return null;
}

/**
 * 理解他刚才在干什么。
 * @param view 活动采样视图（entries 是最近 N 条、已按时间倒序）
 * @param withinMinutes 只看最近多少分钟的记录（默认 45；更早的窗口不算"现在"）
 */
export function understandActivity(view: ActivityView | null | undefined, withinMinutes = 45, table: CategoryDef[] = loadKeywordTable()): ActivityUnderstanding | null {
  if (!view || !view.enabled) return null;
  const recent = (view.entries ?? []).filter(e => Number.isFinite(e.minutesAgo) && e.minutesAgo <= withinMinutes);
  if (recent.length === 0) {
    return {
      summary: '这会儿没看到你在用什么（或者你刚坐下来）',
      category: 'unknown', label: '看不出', confidence: 0,
      windows: 0, spanMinutes: 0, categories: [], evidence: [], vague: true,
    };
  }

  const counts = new Map<ActivityCategory, number>();
  const evidenceByCat = new Map<ActivityCategory, string[]>();
  for (const e of recent) {
    const cat = classifyActivity(e.title, e.process, table);
    if (!cat) continue;
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
    const list = evidenceByCat.get(cat) ?? [];
    const t = String(e.title ?? '').trim();
    if (t && !list.includes(t) && list.length < MAX_EVIDENCE) list.push(t);
    evidenceByCat.set(cat, list);
  }

  const categories: ActivityCategoryHit[] = [...counts.entries()]
    .map(([key, count]) => {
      const def = table.find(d => d.key === key);
      return { key, label: def?.label ?? key, count, share: Math.round((count / recent.length) * 100) / 100 };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 4);

  const spanMinutes = Math.max(...recent.map(e => Number(e.minutesAgo) || 0)) - Math.min(...recent.map(e => Number(e.minutesAgo) || 0));

  if (categories.length === 0) {
    return {
      summary: '你在用电脑，但我看不出具体在做什么',
      category: 'unknown', label: '看不出', confidence: 0,
      windows: recent.length, spanMinutes, categories: [], evidence: recent.slice(0, MAX_EVIDENCE).map(e => e.title), vague: true,
    };
  }

  const top = categories[0];
  const def = table.find(d => d.key === top.key);
  const vague = recent.length < MIN_CONFIDENT_WINDOWS || top.share < 0.4;
  return {
    summary: def?.summary ?? '你在用电脑',
    category: top.key,
    label: top.label,
    confidence: top.share,
    windows: recent.length,
    spanMinutes,
    categories,
    evidence: evidenceByCat.get(top.key) ?? [],
    vague,
  };
}

/** 一句话版（界面标题行用）：理解 + 证据量级 */
export function describeUnderstanding(u: ActivityUnderstanding | null): string {
  if (!u) return '活动采样没开，她看不到你在用什么';
  if (u.category === 'unknown') return u.summary;
  const span = u.spanMinutes > 0 ? `约 ${u.spanMinutes} 分钟里` : '刚才';
  return `${u.summary}（${span} ${u.windows} 个窗口，${Math.round(u.confidence * 100)}% 都是这一类）`;
}

// ===== v1.95 把"理解"接进她的情绪与主动关心 =====

/** 值得她"心里记着"的活动类别（其他类别只展示，不推动她的情绪/主动消息） */
export const CONCERN_CATEGORIES: ActivityCategory[] = ['job', 'meeting', 'study', 'dev'];

export interface ActivityConcern {
  type: 'activity_concern';
  category: ActivityCategory;
  summary: string;
  /** 0~1：作为内在事件的强度传入（习惯化/总上限由 emotionInternal 统一管） */
  intensity: number;
}

/** 理解 → 内在事件（只有非 vague 且属于"关心类"才有；否则 null，不硬编） */
export function toActivityConcern(u: ActivityUnderstanding | null): ActivityConcern | null {
  if (!u || u.vague) return null;
  if (!CONCERN_CATEGORIES.includes(u.category)) return null;
  const intensity = Math.max(0.3, Math.min(1, 0.4 + u.confidence * 0.6));
  return { type: 'activity_concern', category: u.category, summary: u.summary, intensity };
}

/** 给 Prompt 的一行（只在她真的看出来时加；数据陈述，语气由人格决定） */
export function activityPromptLine(u: ActivityUnderstanding | null): string {
  if (!u || u.vague || u.category === 'unknown') return '';
  const span = u.spanMinutes > 0 ? `约 ${u.spanMinutes} 分钟` : '刚才';
  const ev = u.evidence.slice(0, 2).join(' / ');
  const concern = CONCERN_CATEGORIES.includes(u.category) ? '（这件事你可能想自然关心一句，但别像在监控他）' : '';
  return `【我看到的】他${span}一直在${u.label}${ev ? `：${ev}` : ''}${concern}`;
}

/** 主动关心去重/节流用的"持续观察"状态机（纯函数，便于测试） */
export interface CareStreak {
  category: ActivityCategory | null;
  since: number;
  samples: number;
  lastCareAt: number;
  caresToday: number;
  day: string;
}

export function emptyCareStreak(day: string): CareStreak {
  return { category: null, since: 0, samples: 0, lastCareAt: 0, caresToday: 0, day };
}

export const CARE_MIN_SUSTAIN_MS = 20 * 60_000;
export const CARE_COOLDOWN_MS = 90 * 60_000;
export const CARE_MAX_PER_DAY = 2;

/** v1.96 时间窗：她只在这个时段"顺口关心"（凌晨不打扰；与主动消息的 9-22 点同一条原则） */
export const CARE_WINDOW_START_HOUR = 8;
export const CARE_WINDOW_END_HOUR = 23;

/** v1.96 低谷期更矜持（接 v1.40 "降低但不是没有"）：更久才开口、更长冷却、每天只 1 次 */
export const CARE_LOW_SUSTAIN_MS = 40 * 60_000;
export const CARE_LOW_COOLDOWN_MS = 180 * 60_000;
export const CARE_LOW_MAX_PER_DAY = 1;

export interface CareOptions {
  /** 她处在已成段低谷 → 门槛抬高（默认为 false） */
  inLowPeriod?: boolean;
  /** 本地小时（0-23）；给了就做时间窗判断，不给则不做 */
  hour?: number;
}

export interface CareDecision {
  shouldCare: boolean;
  reason: string;
  streak: CareStreak;
  /** 本次判定用的门槛（可观测：低谷时确实更矜持） */
  thresholds?: { sustainMs: number; cooldownMs: number; maxPerDay: number };
}

/**
 * 每次采样（约 1 分钟）调一次：累计"同一类关心活动持续了多久"，到点就值得主动提一句。
 * 规则：时间窗内 → 同一类别连续出现 ≥ 持续阈值 → 冷却 → 当天次数上限；
 *      低谷期门槛更高（40 分钟 / 180 分钟 / 每天 1 次）。
 */
export function updateCareStreak(
  streak: CareStreak,
  u: ActivityUnderstanding | null,
  now: number,
  day: string,
  opts: CareOptions = {},
): CareDecision {
  const low = opts.inLowPeriod === true;
  const thresholds = {
    sustainMs: low ? CARE_LOW_SUSTAIN_MS : CARE_MIN_SUSTAIN_MS,
    cooldownMs: low ? CARE_LOW_COOLDOWN_MS : CARE_COOLDOWN_MS,
    maxPerDay: low ? CARE_LOW_MAX_PER_DAY : CARE_MAX_PER_DAY,
  };
  const s: CareStreak = { ...streak };
  if (s.day !== day) { s.day = day; s.caresToday = 0; }
  const concern = toActivityConcern(u);
  if (!concern) {
    return { shouldCare: false, reason: 'not_a_concern', streak: { ...s, category: null, since: 0, samples: 0 }, thresholds };
  }
  if (typeof opts.hour === 'number' && (opts.hour < CARE_WINDOW_START_HOUR || opts.hour >= CARE_WINDOW_END_HOUR)) {
    return { shouldCare: false, reason: 'outside_window', streak: s, thresholds };
  }
  if (s.category !== concern.category) {
    s.category = concern.category;
    s.since = now;
    s.samples = 1;
    return { shouldCare: false, reason: 'new_category', streak: s, thresholds };
  }
  s.samples += 1;
  const sustained = now - s.since;
  if (sustained < thresholds.sustainMs) return { shouldCare: false, reason: 'not_long_enough', streak: s, thresholds };
  if (now - s.lastCareAt < thresholds.cooldownMs) return { shouldCare: false, reason: 'cooldown', streak: s, thresholds };
  if (s.caresToday >= thresholds.maxPerDay) return { shouldCare: false, reason: 'daily_cap', streak: s, thresholds };
  s.lastCareAt = now;
  s.caresToday += 1;
  return { shouldCare: true, reason: `sustained_${concern.category}`, streak: s, thresholds };
}