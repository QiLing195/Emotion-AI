/**
 * 活动理解层（v1.94）—— 把「他前台开了哪些窗口」归纳成「她理解的他在干什么」。
 *
 * 设计原则：
 *   · **确定性**：纯规则关键词 + 计数/时长聚合，不调模型 ⇒ 不会编造、结果可解释、可测；
 *   · **只说能证明的**：没有匹配 ⇒ 明说"看不出具体在做什么"，不硬猜；
 *   · **给她的是一句"理解" + 证据**，不是让她背的台词（她可以自己接话）；
 *   · 隐私一致：只读采样器给的窗口标题/进程（已脱敏），不读内容、不截屏。
 */
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

/** 把一条窗口标题/进程归到类别（按关键词表顺序，先命中先算） */
export function classifyActivity(title: string, processName?: string): ActivityCategory | null {
  const hay = `${title ?? ''} ${processName ?? ''}`.toLowerCase();
  if (!hay.trim()) return null;
  for (const def of ACTIVITY_KEYWORDS) {
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
export function understandActivity(view: ActivityView | null | undefined, withinMinutes = 45): ActivityUnderstanding | null {
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
    const cat = classifyActivity(e.title, e.process);
    if (!cat) continue;
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
    const list = evidenceByCat.get(cat) ?? [];
    const t = String(e.title ?? '').trim();
    if (t && !list.includes(t) && list.length < MAX_EVIDENCE) list.push(t);
    evidenceByCat.set(cat, list);
  }

  const categories: ActivityCategoryHit[] = [...counts.entries()]
    .map(([key, count]) => {
      const def = ACTIVITY_KEYWORDS.find(d => d.key === key);
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
  const def = ACTIVITY_KEYWORDS.find(d => d.key === top.key);
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
