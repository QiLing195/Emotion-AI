/**
 * v2.13：ExpressionPlan 运行时强制（输出端，不再只靠 Prompt 自觉）
 *
 * 计划器（`expressionPlan.ts`）已经给出结构化约束；之前它只被渲染成一句提示
 * （“最多一句 / 不得说这两天”），模型仍可违反。这里在**生成之后**做最小校验：
 *
 * 1. **时间尺度**：计划不是 `sustained`（即 transient / unknown）时，
 *    回复里“我这两天/这几天/一直…”这类**持续状态**声称要被去掉——只处理
 *    含“我/自己”、且不含“你/他/她/朋友/同事/老板”的句子，避免误改转述别人的事。
 * 2. **提问上限**：`maxQuestions`（默认 1）之外的问号改成句号（保留文字，只去掉追问语气）。
 *
 * 刻意不做：不改写语气、不删整句、不改事实内容；不做“主意图”强制（无可靠判据）。
 * 运行时强制只处理**可判定的违规**，不确定的留给 Prompt 与人工复核。
 */
import type { ExpressionPlan } from './expressionPlan.js';

export interface ExpressionEnforcementResult {
  text: string;
  changed: boolean;
  changes: string[];
}

/** 持续状态词（会被移除，而不是替换成另一个时间词，避免引入新的事实断言） */
const DURATION_RE = /(这两天|这几天|最近几天|这些天|这段时间|最近一阵子|最近一阵|最近一直|一直以来|一直)/g;
const SELF_RE = /我|自己/;
/** 句子若在讲别人/转述，不动它 */
const OTHER_RE = /你|他|她|朋友|同事|老板|家人|父母/;
/** 明确的自我情绪/感受谓词；不匹配“我理解你很难过”等对用户的回应 */
const SELF_AFFECT_RE = /我(?!们)(?:(?:这边|现在|此刻|这会儿|最近|听着|反而|跟着|也|还|大概|确实|可能|其实|先是|后来又|之后又|就)\s*)*(?:(?:的)?(?:心情|心里|情绪|感觉|觉得|感到|有点|有些|挺|很|特别|不太|没那么|没觉得|没有觉得|好像|一下)\s*)*(?:心里发闷|发闷|松了口气|堵在胸口|胸口发堵|心口发堵|堵得慌|跟着堵|踏实|沉|往下沉|往下坠|下坠|起伏(?:了(?:一轮|一下|一阵))?|落下来|缓下来|平复下来|难过|开心|高兴|生气|来气|上火|窝火|恼火|被冒犯|受伤|害怕|不安|烦|轻松|委屈|紧张|担心|放心|失落|焦虑|心累|孤独|在意|想念|心动|渴望|贪念|眼红|羡慕|反感|恶心|感激|感谢|珍惜|安心|尴尬|窘|安静|懒懒(?:的)?|累|好|坏)/;
const IMPLICIT_AFFECT_RE = /^(?:(?:但|不过|只是)\s*)?(?:(?:我现在|我此刻|我这会儿)\s*)?(?:(?:有点|有些|挺|很|特别|不太|没那么|好像)\s*)?(?:心里发闷|发闷|踏实|沉|往下沉|起伏(?:了(?:一轮|一下|一阵))?|落下来|缓下来|平复下来|难过|开心|高兴|生气|愤怒|害怕|不安|烦|轻松|委屈|紧张|担心|放心|失落|焦虑|心累|孤独|在意|想念|尴尬|窘|懒懒(?:的)?|累|说不上是好|说不上是坏)/;
const INLINE_AFFECT_RE = /(?:情绪.{0,3}(?:还)?没缓(?:过来|回来)|缓不过来|心里发闷|发闷|松了口气|堵在胸口|胸口发堵|心口发堵|堵得慌|跟着堵|闷|往下沉|往下坠|下坠|起伏(?:了(?:一轮|一下|一阵))?|落下来|缓下来|平复下来|踏实|沉|安静|难过|开心|高兴|生气|来气|上火|窝火|恼火|被冒犯|受伤|害怕|不安|烦|轻松|委屈|紧张|担心|放心|失落|焦虑|心累|孤独|在意|想念|心动|渴望|贪念|眼红|羡慕|反感|恶心|感激|感谢|珍惜|安心|尴尬|窘|懒懒(?:的)?|提不太起劲|提不起劲|没精神|心情不好|说不上是好|说不上是坏|happy|worried|angry|sad|calm)/i;
const RELATIONAL_AFFECT_RE = /(?:替你|为你)(?:感到|觉得)?(?:真|很|挺)?(?:.{0,12})?(?:高兴|开心|难过|担心|骄傲)/;
/** 直接问近况时，未经逐轮来源计划支持的“事情压在我心里”属于情绪历程声称。 */
const UNVERIFIED_SELF_TRAJECTORY_RE = /(?:我.{0,12}(?:跟着|随着).{0,16}(?:起伏|波动|沉下去|落下来|松了一下|松了一点|轻松|缓下来)|我.{0,8}(?:心里)?(?:是)?跟着.{0,12}(?:沉|松|缓|轻松)(?:了一下|了|下来|一点)?|心里跟着(?:沉|松|缓|轻松)(?:了一下|了|下来|一点)?|跟着你.{0,18}(?:从.{0,8}(?:堵|闷|难受|低落).{0,8}(?:松|轻|缓)|(?:松|轻|缓).{0,8}(?:一点|一下)?)|(?:后来|之后).{0,12}(?:那口气|心里|情绪|状态).{0,8}(?:松|沉|落|缓)|之前那句.{0,16}(?:还)?(?:挂着没散|没散|没过去|压着)|(?:情绪|心情).{0,12}(?:一路|一直|跟着|随着).{0,10}(?:走|起伏|波动)|.{0,32}(?:压在我这儿|压在我心里|挤在我心里|搅在我心里))/u;
const ORPHANED_FRAGMENT_RE = /^(?:(?:不过|但是|但|而且|所以|因为|如果|要是|虽然|只是|反而)[^。！？!?，,；;]{0,18}(?:的时候|以后|之后|时|的话)|[^。！？!?，,；;]{1,18}(?:的时候|以后|之后|时)|真要说的话|说起来的话)[。！？!?…]*$/u;
const AFFECT_BY_EMOTION: Record<string, RegExp> = {
  // `起伏/跟着/落下来` 是一段状态变化的因果叙述，不是当前情绪标签。
  // 当前 plan 没有逐轮轨迹凭据，故不能仅凭 sad 标签放行这类历程声称。
  sad: /沉|闷|堵在胸口|胸口发堵|心口发堵|堵得慌|跟着堵|往下坠|下坠|情绪.{0,3}(?:还)?没缓(?:过来|回来)|缓不过来|难过|失落|提不太起劲|提不起劲|没精神|心累|孤独/,
  joy: /开心|高兴|轻松|欣慰/,
  anger: /生气|来气|上火|窝火|恼火|火大|愤怒|烦/,
  fear: /害怕|不安|紧张|担心|焦虑/,
  anxious: /害怕|不安|紧张|担心|焦虑/,
  disgust: /厌烦|恶心|反感|嫌恶|排斥/,
  love: /喜欢|想念|在意/,
  lust: /心动|渴望|喜欢/,
  greed: /贪念|眼红|羡慕|想要/,
  gratitude: /感激|感谢|珍惜/,
  anxiety: /焦虑|担心|不安|worried/,
  excitement: /兴奋|激动|excited/,
  hope: /期待|有希望|hopeful/,
  neutral: /平静|放松|踏实|安心/,
};

/** 按中文/英文句末标点切句（保留标点，便于原位替换） */
function splitSentences(text: string): string[] {
  const out: string[] = [];
  let buf = '';
  for (const ch of text) {
    buf += ch;
    if (ch === '。' || ch === '！' || ch === '？' || ch === '!' || ch === '?' || ch === '\n') {
      out.push(buf);
      buf = '';
    }
  }
  if (buf) out.push(buf);
  return out;
}

function cleanupSpacing(s: string): string {
  return s
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/我\s+([，。！？])/g, '我$1')
    .replace(/([，。！？])\s+/g, '$1')
    .trim();
}

/** 去掉“她自己的持续状态”声称；返回新句子与命中数 */
function stripDurationClaims(sentence: string): { sentence: string; hits: number } {
  if (!SELF_RE.test(sentence) || OTHER_RE.test(sentence)) return { sentence, hits: 0 };
  let hits = 0;
  const replaced = sentence.replace(DURATION_RE, () => { hits++; return ''; });
  if (hits === 0) return { sentence, hits: 0 };
  return { sentence: cleanupSpacing(replaced), hits };
}

function isInsideQuotation(text: string, index: number): boolean {
  const pairs: Array<[string, string]> = [['「', '」'], ['『', '』'], ['“', '”'], ['"', '"'], ['「', '」']];
  return pairs.some(([open, close]) => {
    const opening = text.lastIndexOf(open, index);
    if (opening < 0) return false;
    const closing = text.indexOf(close, opening + open.length);
    return closing < 0 || index < closing;
  });
}

interface AffectMatch {
  match: RegExpExecArray;
  negated: boolean;
}

function findSelfAffect(clause: string, hasExternalReferent: boolean): AffectMatch | null {
  const explicit = SELF_AFFECT_RE.exec(clause);
  if (explicit && !isInsideQuotation(clause, explicit.index)) return { match: explicit, negated: false };
  const relational = RELATIONAL_AFFECT_RE.exec(clause);
  if (relational) return { match: relational, negated: false };
  if (hasExternalReferent) return null;
  const match = IMPLICIT_AFFECT_RE.exec(clause) ?? INLINE_AFFECT_RE.exec(clause);
  if (!match) return null;
  const prefix = clause.slice(Math.max(0, match.index - 10), match.index).replace(/[，,；;、\s]+$/u, '');
  const negated = /(?:并没有|并不|没有|不是|不|没|未|谈不上|说不上)(?:太|很|那么|特别)?$/u.test(prefix);
  return { match, negated };
}

/** 按情绪子句计数，保留同句中对用户经历的上下文，也避开引号内的转述。 */
function filterSelfAffect(
  sentence: string,
  allowedCount: number,
): { sentence: string; hits: number; kept: number } {
  const hasExternalReferent = OTHER_RE.test(sentence);
  const clauses = sentence.split(/(?<=[，,；;])/u);
  const output: string[] = [];
  let hits = 0;
  let kept = 0;
  for (const clause of clauses) {
    const affect = findSelfAffect(clause, hasExternalReferent);
    if (!affect) {
      output.push(clause);
      continue;
    }
    hits++;
    if (kept < allowedCount) {
      output.push(clause);
      kept++;
      continue;
    }
    const prefix = clause.slice(0, affect.match.index).replace(/[，,；;、——\s]+$/u, '');
    if (prefix && /你|他|她|朋友|同事|老板|offer|这件事/u.test(prefix)) output.push(`${prefix}。`);
  }
  const text = output.join('').replace(/[，,；;]+\s*([。！？!?])/gu, '$1').replace(/[，,；;]+$/u, '。');
  return { sentence: text, hits, kept };
}

/** 直接问她时，只保留与计划情绪一致的一处状态，并删去持续时间和矛盾情绪。 */
function constrainDirectAnswer(sentence: string, emotion: string, alreadyKeptAffect: boolean): { sentence: string; removed: number; durations: number; keptAffect: boolean } {
  const allowed = AFFECT_BY_EMOTION[emotion];
  if (!allowed) return { sentence, removed: 0, durations: 0, keptAffect: alreadyKeptAffect };
  let keptAffect = alreadyKeptAffect;
  let removed = 0;
  let durations = 0;
  const clauses = sentence.split(/(?<=[，,；;])/u);
  const output: string[] = [];
  for (const clause of clauses) {
    const content = clause.replace(/[，,；;。！？!?\s—-]+/gu, '');
    const hasUserReferent = /你|他|她|朋友|同事|老板/.test(content);
    const hasFirstPersonAffect = SELF_AFFECT_RE.test(content) || RELATIONAL_AFFECT_RE.test(content);
    const hasImplicitAffect = !hasUserReferent && INLINE_AFFECT_RE.test(content);
    if (!hasFirstPersonAffect && !hasImplicitAffect) {
      output.push(clause);
      continue;
    }

    const affect = findSelfAffect(clause, hasUserReferent);
    const matchesPlan = Boolean(affect && !affect.negated && allowed.test(content));
    if (matchesPlan && !keptAffect) {
      keptAffect = true;
      const before = clause;
      const after = clause.replace(DURATION_RE, '');
      durations += (before.match(DURATION_RE) ?? []).length;
      output.push(after);
      continue;
    }
    removed++;
  }
  const joined = output.join('');
  const cleaned = joined
    .replace(/[，,；;]+\s*([。！？!?])/gu, '$1')
    .replace(/[，,；;]+$/u, '。');
  return { sentence: cleaned, removed, durations, keptAffect };
}

export function enforceExpressionPlan(
  reply: string,
  plan: ExpressionPlan | null | undefined,
  opts: { enabled?: boolean } = {},
): ExpressionEnforcementResult {
  const changes: string[] = [];
  const text = String(reply ?? '');
  if (opts.enabled === false || !plan || !text.trim()) return { text, changed: false, changes };

  let out = text;
  let removedUnverifiedTrajectory = false;

  // 计划没有记录逐轮情绪来源时，不让直接回答把多个用户事件包装成角色的情绪历程。
  // 只移除含有明确但无来源的情绪历程子句，保留同句内“说不上来”等诚实的不确定表达。
  if (plan.decision === 'express' && plan.directQuestion && !plan.causeQuote) {
    let removed = 0;
    out = splitSentences(out).map((sentence) => {
      if (!UNVERIFIED_SELF_TRAJECTORY_RE.test(sentence)) return sentence;
      const clauses = sentence.split(/(?<=[，,；;])/u);
      const safeClauses = clauses.filter((clause) => {
        if (!UNVERIFIED_SELF_TRAJECTORY_RE.test(clause)) return true;
        removed++;
        return false;
      });
      return safeClauses.join('').replace(/[，,；;]+$/u, '。');
    }).join('');
    if (removed > 0) {
      removedUnverifiedTrajectory = true;
      changes.push(`unverified_affect_trajectory_removed:${removed}`);
    }
  }

  // ① 时间尺度：非 sustained 时不得声称“这两天/一直”
  if (plan.duration !== 'sustained') {
    let totalHits = 0;
    out = splitSentences(out).map((sentence) => {
      const r = stripDurationClaims(sentence);
      if (r.hits > 0) totalHits += r.hits;
      return r.sentence;
    }).join('');
    if (totalHits > 0) changes.push(`duration_claims_removed:${totalHits}`);
  }

  // ② 自我披露：按计划限制自身情绪表达句数。直接问到她但情绪不明时，
  //    只允许表达不确定，不允许模型自行补出具体情绪。
  const directUnclear = plan.decision === 'express'
    && plan.emotion == null
    && (plan.directQuestion || plan.reason.startsWith('direct_question_'));
  if (plan.decision === 'express' && plan.directQuestion && plan.emotion) {
    let mismatched = 0;
    let directDurations = 0;
    let keptDirectAffect = false;
    out = splitSentences(out).map((sentence) => {
      const result = constrainDirectAnswer(sentence, plan.emotion!, keptDirectAffect);
      keptDirectAffect = result.keptAffect;
      mismatched += result.removed;
      directDurations += result.durations;
      return result.sentence;
    }).join('');
    if (mismatched > 0) changes.push(`self_disclosure_conflicts_removed:${mismatched}`);
    if (directDurations > 0) changes.push(`direct_duration_claims_removed:${directDurations}`);
  }
  if (plan.decision === 'silent' || plan.decision === 'express') {
    let keptSelfAffectSentences = 0;
    let removedSelfAffect = 0;
    const maxSelfAffectSentences = plan.decision === 'silent' || directUnclear
      ? 0
      : Math.max(0, plan.maxSentences ?? 0);

    out = splitSentences(out).map((sentence) => {
      const remaining = Math.max(0, maxSelfAffectSentences - keptSelfAffectSentences);
      const result = filterSelfAffect(sentence, remaining);
      keptSelfAffectSentences += result.kept;
      removedSelfAffect += result.hits - result.kept;
      return result.sentence;
    }).join('');

    if (removedSelfAffect > 0) {
      if (plan.decision === 'express' && !directUnclear) {
        const originalCount = removedSelfAffect + keptSelfAffectSentences;
        changes.push(`self_disclosure_capped:${originalCount}->${keptSelfAffectSentences}`);
      } else {
        changes.push(`self_disclosure_removed:${removedSelfAffect}`);
      }
    }
    if (!out.trim() && directUnclear) out = '我现在说不上来。';
    else if (!out.trim() && plan.decision === 'silent') out = '我在听。';
  }

  // ③ 提问上限：多出来的问号改成句号（保留文字，不改内容）
  // ⚠️ silent 计划的 maxQuestions=0 是“不要展开自述/不要追问”，不是“连一句关心都不能问”。
  // 实测把它按 0 执行会把“你说的是哪一句？”改成陈述句（质量下降），所以 silent 至少保留 1 个问题。
  const planCap = Math.max(0, Math.min(3, plan.maxQuestions ?? 1));
  const maxQuestions = plan.decision === 'express' ? planCap : Math.max(1, planCap);
  let seen = 0;
  out = out.replace(/[？?]/g, (m) => {
    seen++;
    return seen <= maxQuestions ? m : '。';
  });
  if (seen > maxQuestions) changes.push(`questions_capped:${seen}->${maxQuestions}`);

  let removedFragments = 0;
  out = splitSentences(out).filter((sentence) => {
    if (!ORPHANED_FRAGMENT_RE.test(sentence.trim())) return true;
    removedFragments++;
    return false;
  }).join('');
  if (removedFragments > 0) changes.push(`orphaned_fragments_removed:${removedFragments}`);
  if (directUnclear && removedUnverifiedTrajectory) {
    out = '我现在说不上来。';
    changes.push('direct_unclear_answer_fallback');
  }
  if (!out.trim() && directUnclear) out = '我现在说不上来。';
  else if (!out.trim() && plan.decision === 'silent') out = '我在听。';

  return { text: out, changed: out !== text, changes };
}
