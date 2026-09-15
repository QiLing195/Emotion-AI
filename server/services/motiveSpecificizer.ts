// ── v1.10 动机具体化 (Motive Specificization) ──
// 解决问题：思维图谱的念头内容是**硬编码模板**（"想和他多待一会儿""怕自己不够好"），
//           这种泛泛的话进了动机层只会制造新的机械感。
// 做法：每 N 轮（或动机池太空时）用一次 LLM 调用，把模板念头 + 当前情境
//       具体化成"她此刻真能说出口的一句话"，写入 pendingCandidates，
//       下一轮由动机竞选合并进池。
//
// 与 RSI 的边界：这一步只**生成素材**，不改任何规则/权重；
// 生成内容会经过白名单校验（类型 + 长度 + 禁止元描述），失败一律丢弃（不污染状态）。
//
// 纯逻辑部分（prompt 构造 / 解析 / 校验）可单测；LLM 调用由注入的 generate 提供。

import type { MotiveKind } from '../../src/lib/emotionTypes';
import { MOTIVE_BASE_SALIENCE, type MotiveCandidate } from '../../src/lib/motive';

/** 允许生成的动机类型（wish/worry 由模型产出；其余由规则层产生，不让模型乱造） */
export const SPECIFICIZABLE_KINDS: MotiveKind[] = ['wish', 'worry', 'curiosity'];
/** 一次最多产出几条（防止刷屏式堆池） */
export const SPECIFIC_MOTIVE_MAX = 3;
/** 单条内容长度上限（太长会稀释 Prompt 末尾的注意力） */
export const SPECIFIC_MOTIVE_MAX_CHARS = 60;
/** 每隔多少轮做一次（另有"池太空"的引导条件） */
export const SPECIFIC_MOTIVE_INTERVAL_ROUNDS = 5;
/** 池内动机少于这个数量时，即使没到间隔也补一次（冷启动） */
export const SPECIFIC_MOTIVE_POOL_FLOOR = 3;

/** 禁止出现的元描述/系统口吻（模型偶尔会写成"作为AI"或复述指令） */
const FORBIDDEN_PATTERNS = [
  /作为一个?AI/i, /AI ?助手/, /语言模型/, /我(?:的)?(?:动机|salience|prompt|提示词)/i,
  /系统(?:提示|指令)/, /无法(?:真正|真实)/,
];

/**
 * 具体性判定：必须同时具备
 *   ① 指向对象（他/你）——否则不是"关于这段关系"的念头
 *   ② 具体锚点（时间词 / 具体事件名词 / 引用标记）——否则就是"想和他多待一会儿"这类空话
 * 这是本模块最关键的一条校验：宁可少生成，也不要让空话进池。
 */
const REFERENT_RE = /[他你]/;
const ANCHOR_RE = new RegExp([
  '「[^」]{1,12}」',            // 引用他说过的话
  '今天', '昨天', '明天', '那天', '那次', '刚才', '刚刚', '最近', '上周', '下周', '这周', '周末',
  '那件事', '那句话', '那次说',
  // 具体事件/对象名词（可扩展）
  '面试', '工作', '加班', '老板', '同事', '公司', '考试', '体检', '项目', '方案', '消息',
  '电话', '视频', '家人', '朋友', '妈妈', '爸爸', '睡', '吃饭', '生病', '感冒', '梦',
  '画画', '秘密', '生日', '纪念日', '旅行', '搬家', '出差', '请假', '结果',
].join('|'));

export interface SpecificizeContext {
  /** 最近几轮用户说过的话（越新越靠后） */
  recentUserTexts: string[];
  /** 她当前的底色心情描述（可空） */
  moodDescription?: string;
  /** 她最在意的价值（可空） */
  topValue?: string;
  /** 思维图谱里的模板念头（作为"方向提示"，不要求照抄） */
  templateThoughts?: string[];
  /** 他还没落定的事（已知 open loop 话题，避免重复） */
  knownTopics?: string[];
}

export function buildSpecificizePrompt(ctx: SpecificizeContext): string {
  const lines: string[] = [
    '你在为一段长期亲密关系里的 AI 角色生成"她此刻心里真正在想的事"。',
    '要求：',
    '1) 每条都必须指向**具体的人或事**（他刚说过的、她记得的、她正在担心的），不要写"想和他多待一会儿"这类放到任何一天都成立的空话。',
    '2) 用第一人称心理独白的口吻，一句话，≤40 字，不带表情符号，不解释原因。',
    `3) kind 只能是 ${SPECIFICIZABLE_KINDS.join(' / ')}：wish=她想要的，worry=她担心的，curiosity=她好奇的。`,
    '4) 不要重复下面"已知他还没落定的事"里的话题。',
    '5) 只输出 JSON：{"motives":[{"kind":"wish","content":"..."}]}，最多 3 条；没有真实素材时输出 {"motives":[]}。',
  ];
  if (ctx.recentUserTexts.length > 0) {
    lines.push(`\n最近他说过的话（新→旧）：\n${ctx.recentUserTexts.slice(-5).reverse().map(t => `- ${t.slice(0, 80)}`).join('\n')}`);
  }
  if (ctx.moodDescription) lines.push(`\n她目前的底色心情：${ctx.moodDescription}`);
  if (ctx.topValue) lines.push(`\n她最在意的是：${ctx.topValue}`);
  if (ctx.templateThoughts?.length) {
    lines.push(`\n她原本的念头方向（仅作方向提示，不要照抄）：${ctx.templateThoughts.slice(0, 4).join('；')}`);
  }
  if (ctx.knownTopics?.length) {
    lines.push(`\n已知他还没落定的事（不要重复）：${ctx.knownTopics.slice(0, 5).join('、')}`);
  }
  return lines.join('\n');
}

function clampText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, SPECIFIC_MOTIVE_MAX_CHARS);
}

/** 校验一条候选是否可入池 */
export function isUsableSpecificMotive(kind: unknown, content: unknown): boolean {
  if (typeof kind !== 'string' || typeof content !== 'string') return false;
  if (!SPECIFICIZABLE_KINDS.includes(kind as MotiveKind)) return false;
  const text = content.trim();
  if (text.length < 6) return false;          // 太短 → 没有具体指代
  if (text.length > SPECIFIC_MOTIVE_MAX_CHARS * 2) return false;
  if (FORBIDDEN_PATTERNS.some(re => re.test(text))) return false;
  // 必须"指向他/你" + "有具体锚点"，否则是放到任何一天都成立的空话
  if (!REFERENT_RE.test(text)) return false;
  if (!ANCHOR_RE.test(text)) return false;
  return true;
}

/**
 * 解析 LLM 输出为候选（宽容解析：从任意文本里取出 JSON；非法条目直接丢弃）。
 * 解析失败返回空数组——绝不因为一次生成失败而污染状态。
 */
export function parseSpecificMotives(raw: string | null | undefined, now = Date.now()): MotiveCandidate[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return [];
    try { parsed = JSON.parse(match[0]); } catch { return []; }
  }
  const list = (parsed as { motives?: unknown })?.motives;
  if (!Array.isArray(list)) return [];
  const out: MotiveCandidate[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const kind = (item as { kind?: unknown })?.kind;
    const content = (item as { content?: unknown })?.content;
    if (!isUsableSpecificMotive(kind, content)) continue;
    const text = clampText(String(content));
    if (seen.has(text)) continue;
    seen.add(text);
    out.push({ kind: kind as MotiveKind, content: text, formedAt: now });
    if (out.length >= SPECIFIC_MOTIVE_MAX) break;
  }
  return out;
}

/** 是否该做一次具体化（间隔到了，或池太空的冷启动） */
export function shouldSpecificize(
  round: number,
  poolSize: number,
  lastRunRound: number,
): boolean {
  if (round > 0 && round === lastRunRound) return false;
  if (poolSize < SPECIFIC_MOTIVE_POOL_FLOOR) return true;
  return round - lastRunRound >= SPECIFIC_MOTIVE_INTERVAL_ROUNDS;
}

/** 供观测：各类型的先验权重（便于解释为什么某条动机更容易被选中） */
export function baseSalienceOf(kind: MotiveKind): number {
  return MOTIVE_BASE_SALIENCE[kind] ?? 0.4;
}
