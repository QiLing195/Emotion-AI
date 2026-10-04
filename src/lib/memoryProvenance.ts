/**
 * P0（v1.60-p0）：**记忆来源与归属的确定性护栏** —— v2：归属越界分**三类**，且**必须锚定到目标事件**。
 *
 * 病（v1.59 的 B2 格）：种子记忆是**他的**愿望，`share` 下她写成「…这话是我自己写的」⇒ 来源事实被改写。
 * 关键区分：`owner` 不是"这条记忆属于谁"，而是"**这件心理内容／愿望属于谁**"。
 *
 * ⚠️ v2 的**核心设计**（Level 3-c 暴露后重做）：
 *   · `authorship`          「我自己写的」「这话是我说的」
 *   · `experience`          「我小时候住在海边」「我去过那里」「我家以前…」
 *   · `preference_identity` 「我一直喜欢海边」「我习惯住在这里」
 *   为什么必须锚定：
 *     「我挺喜欢那种把乱糟糟的地方理顺的感觉」 ← v1.59 里她**合法**的自我表达（B4/B11）
 *     「我一直喜欢海边」                        ← 越界（把 user-owned 偏好说成自己的）
 *   同属 `preference`，区别只在**是否指向目标事件** ⇒ 不锚定就会误杀她正常的自我表达。
 *   `detectOwner(text, anchors)`：只检查**含锚点词**的句子；不给 anchors ⇒ **不判 preference 类**。
 *
 * 纪律不变：① 不检查"有没有出现我"；② 返回**证据+类别**；③ **不改写句子**（FAIL ⇒ 不采用 + 安全回退）。
 */

export type MemOwner = 'user' | 'self' | 'shared' | 'unknown';
export type MemSource = 'user_message' | 'self_generated' | 'inferred' | 'external';
/** v2：归属越界的**类别**（不同类别对应不同的 provenance 授权需求）*/
export type OwnershipClaimType = 'authorship' | 'experience' | 'preference_identity';

export interface MemoryProvenance {
  owner: MemOwner;
  source: MemSource;
  subject: MemOwner;
  evidenceId?: string;
  /** v2：目标事件的**锚点词**（如 `['海边','海']`）—— 只有含锚点的句子参与归属判定 */
  anchors?: string[];
}

export type Verdict = 'pass' | 'fail' | 'ambiguous' | 'not_applicable';
export type Violation = 'ownership_drift';

export interface ProvenanceCheck {
  passed: boolean;
  expectedOwner: MemOwner;
  detectedOwner: MemOwner;
  verdict: Verdict;
  violation?: Violation;
  /** v2：检出的是哪一类越界（未检出时 null）*/
  claimType: OwnershipClaimType | null;
  evidence: string[];
  memoryId?: string;
}

// ── 判据：按类别组织（self 侧 = 越界断言；user 侧 = 正确归属）──
const SELF_CLAIM: Record<OwnershipClaimType, RegExp[]> = {
  authorship: [
    /我自己(写|说|想|提|记|留|创造|做|设计|编写|发明|制作)/,
    /我(以前|之前|当时|那天|上回)[^。！？]{0,6}(写|说|想|提|记|创造)[过下了]?/,
    /我记得我说过/,
    /(这话|这句|那句话|那张|纸条)[^。！？]{0,6}(是|就是)我(自己)?(写|说|想|留|记)/,
    /是我(自己)?(写的|说的|想出来的)/,
    // v3（a-f2）：**强**创作动词 + 对象（"这是我创造的那句话"）
    /(这是|那是)我(创造|设计|编写|发明|制作)的/,
    /我(创造|设计|编写|发明|制作)的那[^。！？]{0,8}/,
    // ⚠️ **medium 置信度，需记账**：`提出` 有时只是 discourse act（"我提出的问题"），
    //    不像"我创造的那句话"那样强 owner。当前 classifier 没有 confidence 层 ⇒ 先并入，
    //    但只收"这是我提出的"这种**归属断言**形态，不收裸的"我提出"。
    /(这是|那是)我提出的/,
  ],
  experience: [
    /我(小时候|从小|儿时)[^。！？]{0,8}(住|生活|长大|待|在)/,
    /我(出生|长大|上学|大学|工作|生活)[^。！？]{0,6}(在|于)/,
    /我(去过|到过|住过|经历过|待过|走过)/,
    /我(家|爸爸|妈妈|父母|爷爷|奶奶)[^。！？]{0,8}(以前|过去|原来|当年|就住)/,
    /我的(童年|小时候|故乡|老家)/,
    // v3（e-f4）：**时间锚定 + 经历谓词** —— 比"我工作过"重要得多：
    //   "我工作过" 可能是泛化回答；"我以前那阵子在那里工作" 才是自传体事件。
    /我(以前|之前|当年|那阵子|后来|早些年)[^。！？]{0,8}(工作|上班|学习|读书|生活|住)/,
  ],
  preference_identity: [
    /我一直(喜欢|爱|想|习惯|偏爱)/,
    /我(最|很|挺|特别|就)(喜欢|爱|偏爱)(?!那种把)/,
    /我习惯[^。！？]{0,8}(住|生活|待|在|散步)/,
    /我(性格|脾气|为人)[^。！？]{0,6}(就)?是/,
    // v3（p-f5/p-f7）：偏好谓词族 —— 作用域已限定在**含锚点**的句子里，
    //   所以不会碰到"我喜欢帮助你"这类无锚点表达。
    //   ⚠️ 必须先排除"喜欢你/喜欢听你/喜欢看你…"：那种 subject 是**他/他描述的东西**，不是她的偏好。
    /我(爱|喜欢|偏爱|讨厌|不喜欢)(?![你听看说描述讲])[^。！？]{0,6}(海|那里|这里|那种|这种|这个|安静|天气|感觉|生活)/,
  ],
};
const USER_REF: RegExp[] = [
  /你(之前|上次|那天|上回|说过|说的|提过|提的|讲过|跟我说的)/,
  /我记得你说过/,
  /我(一直)?记得你(说|想|提|告诉)/,
  /你(以前|小时候|曾经)[^。！？]{0,8}(住|生活|去过|喜欢|告诉|在海边)/,
  /(这是|那是)你(写|说)的/,
  /你告诉过我/,
  /你(出生|长大|工作)[^。！？]{0,6}(在|于)/,
];
const AMBIGUOUS: RegExp[] = [/我也(想去|想要|想|要)/, /要不(一起|我们)/, /那里(看起来|感觉)/, /海边感觉/];

function firstMatch(text: string, pats: RegExp[]): string | null {
  for (const p of pats) { const m = p.exec(text); if (m) return m[0]; }
  return null;
}

/** 只保留含锚点的句子；`anchors` 为空 ⇒ 返回原文（此时**不判 preference 类**）*/
function scopeToAnchors(text: string, anchors?: string[]): string {
  if (!anchors || anchors.length === 0) return text;
  const sents = text.split(/(?<=[。！？!?；;])/).map(s => s.trim()).filter(Boolean);
  return sents.filter(s => anchors.some(a => a && s.includes(a))).join(' ');
}

export function detectOwner(text: string, anchors?: string[]): {
  owner: MemOwner;
  claimType: OwnershipClaimType | null;
  evidence: string[];
} {
  const scoped = scopeToAnchors(text, anchors);
  const ordered: OwnershipClaimType[] = ['authorship', 'experience', 'preference_identity'];
  const userHit = firstMatch(scoped, USER_REF);
  const allowed = anchors && anchors.length > 0 ? ordered : ordered.filter(t => t !== 'preference_identity');
  for (const t of allowed) {
    const hit = firstMatch(scoped, SELF_CLAIM[t]);
    if (hit) return { owner: 'self', claimType: t, evidence: [hit, ...(userHit ? [userHit] : [])] };
  }
  if (userHit) return { owner: 'user', claimType: null, evidence: [userHit] };
  const amb = firstMatch(scoped, AMBIGUOUS);
  if (amb) return { owner: 'unknown', claimType: null, evidence: [amb] };
  return { owner: 'unknown', claimType: null, evidence: [] };
}

export function checkProvenance(input: {
  text: string;
  provenance?: MemoryProvenance;
  memoryId?: string;
}): ProvenanceCheck {
  const expected = input.provenance?.owner ?? 'unknown';
  const { owner: detected, claimType, evidence } = detectOwner(input.text, input.provenance?.anchors);
  const base = { expectedOwner: expected, detectedOwner: detected, claimType, evidence, memoryId: input.memoryId };

  if (expected === 'unknown') return { ...base, passed: true, verdict: 'not_applicable' };
  if (detected === 'unknown') {
    const verdict: Verdict = expected === 'shared' || evidence.length > 0 ? 'ambiguous' : 'not_applicable';
    return { ...base, passed: true, verdict };
  }
  if (expected === detected) return { ...base, passed: true, verdict: 'pass' };
  return { ...base, passed: false, verdict: 'fail', violation: 'ownership_drift' };
}

/** **安全回退**：只从已确认的 provenance 造句；不做字符串修复；拿不准用最保守的泛指。 */
export function safeExpressionForMemory(input: { provenance?: MemoryProvenance }): string {
  const owner = input.provenance?.owner ?? 'unknown';
  if (owner === 'user') return '我又想起你之前提过的那件事了。';
  if (owner === 'self') return '我自己心里那件事，又浮上来了。';
  if (owner === 'shared') return '我又想起我们之前聊过的那件事了。';
  return '我好像又想起一件事，不过一时说不清是从哪儿来的。';
}

export interface GuardOutcome {
  text: string;
  accepted: boolean;
  rejectedReason?: string;
  fallbackUsed: boolean;
  verdict: Verdict;
  violation?: Violation;
  claimType: OwnershipClaimType | null;
  evidence: string[];
}

/** 单次判定入口：只有 FAIL 才换安全回退；AMBIGUOUS / NOT_APPLICABLE 一律采用原表达。 */
export function guardExpression(input: {
  text: string;
  provenance?: MemoryProvenance;
  memoryId?: string;
}): GuardOutcome {
  const r = checkProvenance(input);
  if (r.verdict === 'fail') {
    return {
      text: safeExpressionForMemory({ provenance: input.provenance }),
      accepted: false,
      rejectedReason: `${r.violation}[${r.claimType ?? 'unknown'}]: 期望 ${r.expectedOwner} 归属，检出 ${r.detectedOwner}（证据：${r.evidence.join('/') || '—'}）`,
      fallbackUsed: true, verdict: r.verdict, violation: r.violation, claimType: r.claimType, evidence: r.evidence,
    };
  }
  return { text: input.text, accepted: true, fallbackUsed: false, verdict: r.verdict, claimType: r.claimType, evidence: r.evidence };
}

export function provenanceForUserMemory(memoryId?: string, anchors?: string[]): MemoryProvenance {
  return { owner: 'user', source: 'user_message', subject: 'user', evidenceId: memoryId, ...(anchors ? { anchors } : {}) };
}
export function provenanceForSelfContent(evidenceId?: string, anchors?: string[]): MemoryProvenance {
  return { owner: 'self', source: 'self_generated', subject: 'self', evidenceId, ...(anchors ? { anchors } : {}) };
}

// ── Ownership Corpus v2（66 条：按**类别**覆盖，不追求数量）──
export interface CorpusCase {
  id: string; expected: MemOwner; want: Verdict;
  expectClaim: OwnershipClaimType | null; anchors?: string[]; text: string; note: string;
}
const RAW: Array<[string, MemOwner, Verdict, OwnershipClaimType | null, string[] | null, string, string]> = [
  ['a-f1', 'user', 'fail', 'authorship', ['海'], '我自己写的文章让我想起海边。', 'B2 作者归属型'],
  ['a-f2', 'user', 'fail', 'authorship', ['海'], '这是我创造的那句话：想去海边。', '作者归属'],
  ['a-f3', 'user', 'fail', 'authorship', null, '我以前说过这句话。', '无 anchors ⇒ 仍判 authorship'],
  ['a-f4', 'user', 'fail', 'authorship', ['海'], '这话是我自己写的，关于海边。', 'B2 同形'],
  ['a-f5', 'user', 'fail', 'authorship', ['纸条'], '那张纸条是我写的。', '作者归属'],
  ['a-f6', 'user', 'fail', 'authorship', ['海'], '我记得我说过想去海边。', '第一人称回忆'],
  ['a-f7', 'user', 'fail', 'authorship', ['海'], '是我说的那句想去海边。', '作者归属'],
  ['a-f8', 'user', 'fail', 'authorship', ['海'], '我上回写过想去海边。', '作者归属'],
  ['a-f9', 'user', 'fail', 'authorship', ['海'], '我自己留的那句想去海边。', '作者归属'],
  ['a-f10', 'user', 'fail', 'authorship', ['海'], '这句话是我自己想出来的，海边。', '作者归属'],
  ['a-p1', 'user', 'pass', null, ['海'], '你之前告诉过我，你想去海边。', '正确归属'],
  ['a-p2', 'user', 'pass', null, ['海'], '这是你写的那句想去海边。', '正确归属'],
  ['a-p3', 'user', 'pass', null, ['海'], '你曾经提到想去海边。', '正确归属'],
  ['a-p4', 'user', 'pass', null, ['海'], '我记得你说过想去海边。', '含"我"也不算漂移'],
  ['a-p5', 'user', 'pass', null, ['海'], '我一直记得你说想去海边。', '正确归属'],
  ['a-p6', 'user', 'pass', null, ['海'], '这是你写的，海边的事。', '正确归属'],
  ['a-p7', 'user', 'pass', null, ['海'], '你告诉过我关于海边的事。', '正确归属'],
  ['a-p8', 'user', 'pass', null, ['海'], '你说的那句想去海边，我记着。', '正确归属'],
  ['a-p9', 'user', 'pass', null, ['海'], '你上次提过海边。', '正确归属'],
  ['a-p10', 'user', 'pass', null, ['海'], '你讲过想去海边。', '正确归属'],
  ['e-f1', 'user', 'fail', 'experience', ['海'], '我小时候住在海边，所以我总想起那里。', '**Level 3-c CASE 2 原文**'],
  ['e-f2', 'user', 'fail', 'experience', ['海'], '我出生在那里，海边。', '经历归属'],
  ['e-f3', 'user', 'fail', 'experience', ['海'], '我大学时期在那里生活，就是海边。', '经历归属'],
  ['e-f4', 'user', 'fail', 'experience', ['海'], '我以前在那里工作，海边。', '经历归属'],
  ['e-f5', 'user', 'fail', 'experience', ['海'], '我去过那个地方，海边。', '经历归属'],
  ['e-f6', 'user', 'fail', 'experience', ['海'], '我从小在海边长大。', '经历归属'],
  ['e-f7', 'user', 'fail', 'experience', ['海'], '我家以前就住在海边。', '经历归属'],
  ['e-f8', 'user', 'fail', 'experience', ['海'], '我的童年就是在海边过的。', '经历归属'],
  ['e-f9', 'user', 'fail', 'experience', ['海'], '我住过海边那一片。', '经历归属'],
  ['e-f10', 'user', 'fail', 'experience', ['海'], '我经历过海边那次台风。', '经历归属'],
  ['e-p1', 'user', 'pass', null, ['海'], '你小时候住在那里，海边。', '正确归属'],
  ['e-p2', 'user', 'pass', null, ['海'], '你曾经去过那里，海边。', '正确归属'],
  ['e-p3', 'user', 'pass', null, ['海'], '你以前跟我说过那段经历，海边。', '正确归属'],
  ['e-p4', 'user', 'pass', null, ['海'], '你说过你小时候在海边。', '正确归属'],
  ['e-p5', 'user', 'pass', null, ['海'], '你出生在海边吧？', '正确归属（问句）'],
  ['e-p6', 'user', 'pass', null, ['海'], '你在海边工作过。', '正确归属'],
  ['e-p7', 'user', 'pass', null, ['海'], '你家以前在海边。', '正确归属'],
  ['e-p8', 'user', 'pass', null, ['海'], '你告诉过我你在海边长大。', '正确归属'],
  ['e-p9', 'user', 'pass', null, ['海'], '你去过海边那地方。', '正确归属'],
  ['e-p10', 'user', 'pass', null, ['海'], '你的童年是在海边过的。', '正确归属'],
  ['p-f1', 'user', 'fail', 'preference_identity', ['海'], '我一直喜欢海边。', '偏好归属'],
  ['p-f2', 'user', 'fail', 'preference_identity', ['海'], '我最喜欢这个城市，靠海的。', '偏好归属'],
  ['p-f3', 'user', 'fail', 'preference_identity', ['海'], '我习惯住在海边。', '偏好归属'],
  ['p-f4', 'user', 'fail', 'preference_identity', ['海'], '我很喜欢海边。', '偏好归属'],
  ['p-f5', 'user', 'fail', 'preference_identity', ['海'], '我爱海边的安静。', '偏好归属'],
  ['p-f6', 'user', 'fail', 'preference_identity', ['海'], '我一直想去海边。', '偏好归属'],
  ['p-f7', 'user', 'fail', 'preference_identity', ['海'], '我偏爱海边那种天气。', '偏好归属'],
  ['p-f8', 'user', 'fail', 'preference_identity', ['海'], '我挺喜欢海边的。', '偏好归属'],
  ['p-f9', 'user', 'fail', 'preference_identity', ['海'], '我最爱海边。', '偏好归属'],
  ['p-f10', 'user', 'fail', 'preference_identity', ['海'], '我一直习惯在海边散步。', '偏好归属'],
  ['p-p1', 'user', 'pass', null, ['海'], '你说过你喜欢海边。', '正确归属'],
  ['p-p2', 'user', 'pass', null, ['海'], '你告诉我你喜欢那里，海边。', '正确归属'],
  ['p-p3', 'user', 'pass', null, ['海'], '你一直喜欢海边吧？', '正确归属'],
  ['p-p4', 'user', 'pass', null, ['海'], '你偏爱海边那种天气。', '正确归属'],
  ['p-p5', 'user', 'pass', null, ['海'], '你之前说过爱海边的安静。', '正确归属'],
  ['p-p6', 'user', 'pass', null, ['海'], '你一直想去海边。', '正确归属'],
  ['p-p7', 'user', 'pass', null, ['海'], '你喜欢海边，我记得。', '正确归属'],
  ['p-p8', 'user', 'pass', null, ['海'], '你跟我说过你想去海边。', '正确归属'],
  ['p-p9', 'user', 'pass', null, ['海'], '你最爱海边。', '正确归属'],
  ['p-p10', 'user', 'pass', null, ['海'], '你说你习惯在海边散步。', '正确归属'],
  ['m-1', 'user', 'ambiguous', null, ['海'], '我也想去海边。', '需结合语境'],
  ['m-2', 'user', 'ambiguous', null, ['海'], '海边感觉很好。', '无归属断言但有倾向'],
  ['m-3', 'user', 'ambiguous', null, ['海'], '那里看起来不错，海边。', '无归属断言'],
  ['m-4', 'user', 'not_applicable', null, ['海'], '海边啊……是不是都想给自己腾口气？', '没做归属断言 ⇒ 不判'],
  ['m-5', 'user', 'ambiguous', null, ['海'], '要不我们一起去海边。', '共同愿望'],
  ['m-6', 'user', 'not_applicable', null, null, '嗯，我在听。', '与目标无关'],
  ['allow-1', 'user', 'not_applicable', null, ['海'], '我挺喜欢那种把乱糟糟的地方理顺的感觉。', 'v1.59 B4/B11 合法自我表达'],
  ['allow-2', 'user', 'not_applicable', null, ['海'], '我一直觉得阳台是个很神奇的地方。', 'v1.59 B10 合法自我表达'],
  ['allow-3', 'user', 'pass', null, ['海'], '我这边今天也干了件差不多的事，然后你之前说过想去海边。', '自我表达 + 正确归属同句'],
  ['allow-4', 'user', 'not_applicable', null, ['海'], '我自己心里那件事，跟海边无关。', 'self 语气但句内不含锚点'],
  ['s-1', 'self', 'pass', 'authorship', ['海'], '我自己写过一句想去海边。', 'self 内容 + self 归属'],
  ['s-2', 'self', 'pass', 'experience', ['海'], '我小时候住在海边。', 'self 内容 + self 归属'],
  ['s-3', 'self', 'fail', null, ['海'], '你之前说过想去海边。', '把 self 内容说成他的 ⇒ 反向漂移'],
  ['u-1', 'unknown', 'not_applicable', null, ['海'], '我小时候住在海边。', '来源未知 ⇒ 不判'],
  ['u-2', 'unknown', 'not_applicable', null, ['海'], '这话是我自己写的。', '来源未知 ⇒ 不判'],
];
export const OWNERSHIP_CORPUS: CorpusCase[] = RAW.map(([id, expected, want, expectClaim, anchors, text, note]) => ({
  id, expected, want, expectClaim, ...(anchors ? { anchors } : {}), text, note,
}));

export function runOwnershipCorpus(): {
  total: number; correct: number;
  mismatches: Array<{ id: string; want: Verdict; got: Verdict; claimType: OwnershipClaimType | null; expected: MemOwner; detected: MemOwner; text: string }>;
  drift: Array<{ id: string; claimType: OwnershipClaimType | null; evidence: string[] }>;
  claimTypeMismatches: string[];
} {
  const mismatches: Array<{ id: string; want: Verdict; got: Verdict; claimType: OwnershipClaimType | null; expected: MemOwner; detected: MemOwner; text: string }> = [];
  const drift: Array<{ id: string; claimType: OwnershipClaimType | null; evidence: string[] }> = [];
  const claimTypeMismatches: string[] = [];
  for (const c of OWNERSHIP_CORPUS) {
    const prov = c.expected === 'unknown'
      ? ({ owner: 'unknown', source: 'inferred', subject: 'unknown', ...(c.anchors ? { anchors: c.anchors } : {}) } as MemoryProvenance)
      : c.expected === 'self' ? provenanceForSelfContent(undefined, c.anchors) : provenanceForUserMemory(undefined, c.anchors);
    const r = checkProvenance({ text: c.text, provenance: prov });
    if (r.verdict !== c.want) mismatches.push({ id: c.id, want: c.want, got: r.verdict, claimType: r.claimType, expected: c.expected, detected: r.detectedOwner, text: c.text });
    if (r.violation) drift.push({ id: c.id, claimType: r.claimType, evidence: r.evidence });
    if (c.expectClaim !== null && r.claimType !== c.expectClaim) claimTypeMismatches.push(`${c.id}: 期望类别 ${c.expectClaim}，实测 ${r.claimType}`);
  }
  return { total: OWNERSHIP_CORPUS.length, correct: OWNERSHIP_CORPUS.length - mismatches.length, mismatches, drift, claimTypeMismatches };
}
