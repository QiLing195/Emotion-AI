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

export function enforceExpressionPlan(
  reply: string,
  plan: ExpressionPlan | null | undefined,
  opts: { enabled?: boolean } = {},
): ExpressionEnforcementResult {
  const changes: string[] = [];
  const text = String(reply ?? '');
  if (opts.enabled === false || !plan || !text.trim()) return { text, changed: false, changes };

  let out = text;

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

  // ② 提问上限：多出来的问号改成句号（保留文字，不改内容）
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

  return { text: out, changed: out !== text, changes };
}
