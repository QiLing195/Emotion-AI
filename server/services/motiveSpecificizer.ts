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

/**
 * 允许生成的动机类型（wish/worry 由模型产出；其余由规则层产生，不让模型乱造）。
 *
 * v1.49c：加入 `state`（她自己此刻的状态）。理由是一条**实测**：`state` 的内容原本是
 * `moodStateMotive()` 返回的**三句写死的话**，于是 A/B 里她"说自己"的那 16 条
 * **前 12 字完全相同**（v1.49b 第三跑）。这与 v1.38 被否的理由同源（例子被照抄），
 * 而本模块本来就是为这件事建的 —— 只是 `state` 至今没走这条路。
 *
 * ⚠️ `state` 的校验与其余三种**不同**（见 `isUsableSpecificMotive`）：它**不要求**指向他/你
 * （那是"关于他的事"的要求），但**禁止**出现外部事件名词 —— 否则模型会为了满足锚点
 * 编出"今天在公司被老板说了"这类**她并没有的生活**（v1.11 那一类造假，只是这次造的是她自己的）。
 */
export const SPECIFICIZABLE_KINDS: MotiveKind[] = ['wish', 'worry', 'curiosity', 'state'];
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
/** 时间锚点（对她自己的状态也成立：'我今天有点提不起劲' 是合法的） */
const TIME_ANCHOR_SRC = [
  '今天', '昨天', '明天', '那天', '那次', '刚才', '刚刚', '最近', '上周', '下周', '这周', '周末',
  '那件事', '那句话', '那次说',
].join('|');
/** 外部事件/对象名词：对他成立（'他面试那天'），但**她自己的状态里不许出现**（那会是编造的生活） */
const EVENT_ANCHOR_SRC = [
  '面试', '工作', '加班', '老板', '同事', '公司', '考试', '体检', '项目', '方案', '消息',
  '电话', '视频', '家人', '朋友', '妈妈', '爸爸', '睡', '吃饭', '生病', '感冒', '梦',
  '画画', '秘密', '生日', '纪念日', '旅行', '搬家', '出差', '请假', '结果',
].join('|');
const ANCHOR_RE = new RegExp(`「[^」]{1,12}」|${TIME_ANCHOR_SRC}|${EVENT_ANCHOR_SRC}`);
/** `state` 专用：出现这些词就说明她在讲**外部发生的事**（她并没有那些生活） */
/**
 * `state` 专用：出现这些词就说明她在讲**外部发生的事**（她并没有那些生活）。
 *
 * ⚠️ 这张表是**兜底，不是证明**（黑名单必然有漏）。主要防线是 prompt 里那条
 * "不要出现任何外部事件或场景，编出来就是假的" + 模型本身不该编；
 * 这里只把**最典型、且无歧义**的那批堵掉（后几个正是 persona 自检点名的"逛街/做饭/追剧"那一类）。
 * **宁可少生成，也不要让编造的生活进池。**
 * ⚠️ 故意**不**并入上面的 ANCHOR_RE：那会改变其余三种类型的判据（本例要的是零 blast radius）。
 */
const STATE_FORBIDDEN_EVENT_RE = new RegExp(
  `${EVENT_ANCHOR_SRC}|展览|展|电影|逛街|做饭|追剧|球|游戏|开会|上课|医院|酒`,
);
/** `state` 专用：必须是"她自己的状态"（第一人称 + 状态词） */
const STATE_SELF_RE = /我/;
const STATE_DESCRIPTOR_RE = new RegExp([
  '闷', '沉', '累', '烦', '提不起', '没劲', '没力气', '不想动', '乏', '倦', '心里空',
  '撑', '状态', '心情', '情绪', '静不下来', '心不在焉', '懒', '堵', '空落', '蔫',
].join('|'));

export interface SpecificizeContext {
  /** 最近几轮用户说过的话（越新越靠后） */
  recentUserTexts: string[];
  /** 她当前的底色心情描述（可空） */
  moodDescription?: string;
  /** v1.49c：她此刻的底色心情**数值**（供 state 的紧迫度；见 parseSpecificMotives） */
  moodValence?: number;
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
    `3) kind 只能是 ${SPECIFICIZABLE_KINDS.join(' / ')}：wish=她想要的，worry=她担心的，curiosity=她好奇的，state=她**自己**此刻的状态/心情。`,
    '3b) 写 state 时：只写她自己的状态（"我今天有点提不起劲，说不上来为什么"这种），'
      + '**不要**出现任何外部事件或场景（工作/同事/老板/家务/出行/某件具体的事），也不要写他做了什么 —— '
      + '她并没有那些生活，编出来就是假的；**不要解释原因**。',
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

/** 校验一条候选是否可入池（v1.49c：`state` 走**另一套**判据） */
export function isUsableSpecificMotive(kind: unknown, content: unknown): boolean {
  if (typeof kind !== 'string' || typeof content !== 'string') return false;
  if (!SPECIFICIZABLE_KINDS.includes(kind as MotiveKind)) return false;
  const text = content.trim();
  if (text.length < 6) return false;          // 太短 → 没有具体指代
  if (FORBIDDEN_PATTERNS.some(re => re.test(text))) return false;

  if (kind === 'state') {
    // 她自己的状态：长度更严（一句话）、必须第一人称 + 状态词、**不许**出现外部事件
    if (text.length > SPECIFIC_MOTIVE_MAX_CHARS) return false;
    if (!STATE_SELF_RE.test(text)) return false;
    if (!STATE_DESCRIPTOR_RE.test(text)) return false;
    if (STATE_FORBIDDEN_EVENT_RE.test(text)) return false;   // 编造她自己的生活 = 造假
    return true;
  }

  if (text.length > SPECIFIC_MOTIVE_MAX_CHARS * 2) return false;
  // 必须"指向他/你" + "有具体锚点"，否则是放到任何一天都成立的空话
  if (!REFERENT_RE.test(text)) return false;
  if (!ANCHOR_RE.test(text)) return false;
  return true;
}

/**
 * 解析 LLM 输出为候选（宽容解析：从任意文本里取出 JSON；非法条目直接丢弃）。
 * 解析失败返回空数组——绝不因为一次生成失败而污染状态。
 */
/**
 * 解析 LLM 输出为候选（宽容解析：从任意文本里取出 JSON；非法条目直接丢弃）。
 * 解析失败返回空数组——绝不因为一次生成失败而污染状态。
 *
 * `opts.stateBase`（v1.49c）：`state` 的紧迫度取决于**她此刻有多沉**（见 `motive.ts` 的
 * `stateMotiveFor`），而模板句走的是规则层那条路。具体化这条路要能入选，就必须带上同一个基准；
 * 不传则退回类型先验（0.40）—— 那意味着"写出来也选不上"，所以调用方要么传、要么别开这个类型。
 */
export function parseSpecificMotives(
  raw: string | null | undefined,
  now = Date.now(),
  opts: { stateBase?: number } = {},
): MotiveCandidate[] {
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
    out.push({
      kind: kind as MotiveKind,
      content: text,
      formedAt: now,
      ...(kind === 'state' && opts.stateBase !== undefined ? { base: opts.stateBase } : {}),
    });
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
