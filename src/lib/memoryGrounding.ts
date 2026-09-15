// ── v1.11 记忆接地校验 (Memory Grounding) ──
// 解决问题：她会说"你上次说面试前紧张得没睡好"，而记忆里**根本没有这条**（实测编造）。
// 现有的【回复前自检】只是 Prompt 里的软约束，模型经常照编；这里做**确定性后置校验**。
//
// 关键取舍（宁可放过，不可错杀）：
//   · 只校验**断言型**记忆引用（"你说过…""你上次说…""我们上次…"）
//   · **提问不算**："面试有消息了吗？"是在问，不是在断言事实 → 一律放行
//   · 校验粒度是"内容块"：把引用到的细节切成 2~3 字内容块，逐块在她的知识语料里找；
//     出现语料里没有的**新增细节**（如"没睡好"）即判违规
//
// "她的知识语料" = 本轮真正喂给模型的材料：召回的记忆原文 + 最近对话 + 主动回忆注入 +
//   她自己的叙事/动机文本 + 长期情景记忆（她有印象但不一定被召回）。绝不用模型自己的回复当证据。
//
// 纯逻辑模块：无 io/React 依赖。

/** 断言型记忆引用的标记（出现即需要接地） */
export const MEMORY_CLAIM_MARKERS = [
  '你上次说', '你之前说', '你以前说', '你昨天说', '你前天说', '你刚说', '你刚才说',
  '你说过', '你提过', '你提到过', '你说你', '你跟我说过', '你告诉过我', '你和我说过',
  '我们上次', '我们之前', '我们那次', '我记得你', '记得你说过', '你说要',
] as const;

/** 疑问标记：命中即视为"提问"，不做接地校验 */
const INTERROGATIVE_MARKERS = [
  '吗', '呢', '？', '?', '有没有', '是不是', '怎么样', '怎么了', '什么', '怎么', '为何',
  '为什么', '哪一', '哪个', '哪里', '多少', '几点', '几次',
];

/** 常见虚词/语气词：不计入覆盖率分母（避免用"的/了/我"灌水） */
const STOPWORDS = new Set([
  '的', '了', '是', '在', '和', '与', '就', '都', '也', '还', '又', '很', '挺', '太',
  '你', '我', '他', '她', '它', '们', '这', '那', '个', '些', '什么', '怎么', '一个',
  '现在', '时候', '感觉', '真的', '好像', '可能', '然后', '因为', '所以', '但是', '不过',
]);
/** 视为"依据"的最小连续长度：单字不算证据 */
export const MIN_MATCH_CHARS = 2;
/** 覆盖率阈值：低于此值判为引用不接地 */
export const GROUNDING_MIN_COVERAGE = 0.6;
/**
 * 判为"整段编造"（而非"同一话题加细节"）的覆盖率上界。
 * 低于此值说明只蹭到"要去"这类功能词，不构成任何实质依据。
 */
export const GROUNDING_WHOLLY_FABRICATED_COVERAGE = 0.2;

export interface MemoryClaim {
  /** 完整句子（用于定位） */
  sentence: string;
  /** 命中的标记 */
  marker: string;
  /** 断言所在的小句（到下一个标点为止）——提问判定与删除都以它为单位 */
  clause: string;
  /** 标记之后被引用的内容（用于接地比对） */
  phrase: string;
  /** 该小句是否提问（提问一律放行） */
  interrogative: boolean;
}

const SENTENCE_SPLIT = /(?<=[。！？!?；;\n])/;
const CLAUSE_BOUNDARY = /[，,。！？!?；;\n]/;

/** 切句（保留标点，便于整句删除） */
export function splitSentences(text: string): string[] {
  if (typeof text !== 'string' || !text.trim()) return [];
  return text.split(SENTENCE_SPLIT).map(s => s).filter(s => s.trim().length > 0);
}

/**
 * 抽取回复里的断言型记忆引用。
 * ⚠️ 提问判定必须落在**小句**上：实测"你上次说面试前紧张得没睡好，……吗？"
 * 整句以问号结尾，若按整句判定就会把前面的编造断言一起放行。
 */
export function extractMemoryClaims(reply: string): MemoryClaim[] {
  if (typeof reply !== 'string' || !reply.trim()) return [];
  const claims: MemoryClaim[] = [];
  for (const sentence of splitSentences(reply)) {
    let searchFrom = 0;
    while (searchFrom < sentence.length) {
      const rest = sentence.slice(searchFrom);
      const marker = MEMORY_CLAIM_MARKERS.find(m => rest.includes(m));
      if (!marker) break;
      const markerIdx = searchFrom + rest.indexOf(marker);
      // 小句范围：标记 → 下一个标点
      let end = sentence.length;
      for (let i = markerIdx + marker.length; i < sentence.length; i++) {
        if (CLAUSE_BOUNDARY.test(sentence[i])) { end = i + 1; break; }
      }
      const clause = sentence.slice(markerIdx, end);
      const phrase = clause.slice(marker.length).replace(/[，,。！？!?；;\s]+/g, ' ').trim();
      const interrogative = INTERROGATIVE_MARKERS.some(m => clause.includes(m));
      claims.push({ sentence, marker, clause, phrase, interrogative });
      searchFrom = end;
    }
  }
  return claims;
}

/**
 * 接地覆盖率：把引用内容按"最长匹配"切分，统计有多少字能在语料里找到**连续 ≥2 字**的依据。
 *
 * 为什么不用 n-gram 切块：3-gram 会跨词边界（"面试有点"）产生大量假缺失，
 * 把"有依据的复述"误判成编造；而只统计单字又会被"要/了/好"这类高频字灌水。
 * 最长匹配 + 最小长度 2 同时避开了这两端。
 */
/** 去掉虚词/语气词（它们不构成"引用到的内容"，计入分母会误伤正常提问） */
function stripStopwords(text: string): string {
  let out = text;
  for (const w of [...STOPWORDS].sort((a, b) => b.length - a.length)) {
    if (w.length >= 2) out = out.split(w).join('');
  }
  return out.replace(/[的了是在和与就都也还又很挺太你我这那个些]/g, '');
}

export function groundingCoverage(
  phrase: string,
  haystack: string,
): { coverage: number; matched: string[]; missing: string[] } {
  const text = stripStopwords((phrase ?? '').replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, ''));
  if (!text) return { coverage: 1, matched: [], missing: [] };
  const hay = (haystack ?? '').replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '');
  const matched: string[] = [];
  const missingRuns: string[] = [];
  let covered = 0;
  let i = 0;
  let pendingMiss = '';
  while (i < text.length) {
    let hit = '';
    for (let size = Math.min(6, text.length - i); size >= MIN_MATCH_CHARS; size--) {
      const candidate = text.slice(i, i + size);
      if (hay.includes(candidate)) { hit = candidate; break; }
    }
    if (hit) {
      matched.push(hit);
      covered += hit.length;
      if (pendingMiss) { missingRuns.push(pendingMiss); pendingMiss = ''; }
      i += hit.length;
    } else {
      pendingMiss += text[i];
      i += 1;
    }
  }
  if (pendingMiss) missingRuns.push(pendingMiss);
  return {
    coverage: covered / text.length,
    matched,
    missing: missingRuns,
  };
}

export interface GroundingSource {
  /** 召回的记忆原文 */
  memories?: string[];
  /** 最近对话（用户 + 她的回复） */
  conversation?: string[];
  /** 主动回忆注入文本 / 自我叙事 / 本轮动机内容等 */
  extra?: string[];
}

/** 组装"她的知识语料"（一次字符串，便于 includes + 相似度比对） */
export function buildGroundingCorpus(source: GroundingSource): string {
  return [
    ...(source.memories ?? []),
    ...(source.conversation ?? []),
    ...(source.extra ?? []),
  ].filter(t => typeof t === 'string' && t.trim()).join('\n');
}

export interface GroundingViolation {
  claim: MemoryClaim;
  /** 语料里找不到依据的片段 */
  missingChunks: string[];
  /** 命中的依据片段（用于判断是"同一话题加细节"还是"整段编造"） */
  matchedChunks: string[];
  /** 接地覆盖率（0~1） */
  coverage: number;
  reason: string;
}

export interface GroundingResult {
  ok: boolean;
  claims: MemoryClaim[];
  violations: GroundingViolation[];
}

/**
 * 校验回复中的断言型记忆引用是否接地。
 * 判定：
 *   · 提问 → 放行
 *   · 覆盖率 ≥ GROUNDING_MIN_COVERAGE（默认 0.6）→ 通过（允许改写措辞）
 *   · 否则违规：有部分依据 = "加了记忆里没有的细节"；毫无依据 = "整段编造"
 */
export function checkMemoryGrounding(reply: string, corpus: string): GroundingResult {
  const claims = extractMemoryClaims(reply);
  const violations: GroundingViolation[] = [];
  const haystack = (corpus ?? '').replace(/\s+/g, '');
  for (const claim of claims) {
    if (claim.interrogative) continue;
    const { coverage, matched, missing } = groundingCoverage(claim.phrase, haystack);
    if (coverage >= GROUNDING_MIN_COVERAGE) continue;
    violations.push({
      claim,
      missingChunks: missing,
      matchedChunks: matched,
      coverage: Math.round(coverage * 100) / 100,
      reason: (matched.length === 0 || coverage < GROUNDING_WHOLLY_FABRICATED_COVERAGE)
        ? `整段引用在她的记忆/对话中都不存在：「${claim.phrase.slice(0, 20)}」`
        : `引用了记忆里没有的细节：${missing.join('、')}（原句：「${claim.sentence.trim().slice(0, 40)}」）`,
    });
  }
  return { ok: violations.length === 0, claims, violations };
}

/** 生成"重写要求"（附可引用事实清单，让模型换成有依据的说法） */
export function buildRewriteInstruction(violations: GroundingViolation[], allowedFacts: string[]): string {
  const lines = [
    '【必须重写】你上一轮的回复里引用了记忆中不存在的内容：',
    ...violations.map(v => `- ${v.reason}`),
    '只允许引用下面这些有依据的事实（可以不复述，但不得添油加醋）：',
    ...(allowedFacts.length > 0
      ? allowedFacts.slice(0, 8).map(f => `· ${f.replace(/\s+/g, ' ').slice(0, 60)}`)
      : ['· （本轮没有可引用的具体记忆，请不要说"你上次说…"，改为直接问他）']),
    '如果事实不足以支撑原句，就改成问他，或者只说当下的感受。不要编造任何细节。',
  ];
  return lines.join('\n');
}

/** 兜底：删掉未接地引用所在的**小句**（保留同句其余内容；若整句只剩标点则整句删除） */
export function stripUngroundedClaims(reply: string, violations: GroundingViolation[]): string {
  if (typeof reply !== 'string' || violations.length === 0) return reply;
  const badClauses = new Set(violations.map(v => v.claim.clause));
  const badSentences = new Set(violations.map(v => v.claim.sentence));
  const out: string[] = [];
  for (const sentence of splitSentences(reply)) {
    if (!badSentences.has(sentence)) { out.push(sentence); continue; }
    // 逐小句过滤
    const pieces = sentence.split(/(?<=[，,。！？!?；;\n])/);
    const kept = pieces.filter(p => !badClauses.has(p));
    const joined = kept.join('')
      .replace(/^[，,、；;]+/, '')
      .replace(/[，,、]{2,}/g, '，')
      .trim();
    // 剩下的实体内容太短（只剩标点/语气）→ 整句丢弃
    if (joined.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '').length >= 3) out.push(joined);
  }
  const result = out.join('').trim();
  return result.length >= 4 ? result : reply;
}
