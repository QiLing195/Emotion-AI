/**
 * 可审计人格评估 bench（v1.60 Stage B）—— **只读**，不调用模型、不改任何状态。
 *
 * 为什么需要它（用户的要求）：不要问"她这轮像不像她"，要问"她违反了哪一条 checklist、
 * 证据是哪一轮哪一句"。本脚本把 `artifacts/v1.60/eval/persona-checklist-v0.json` 里的条目
 * 变成**确定性检测器**，在已有语料上跑出：通过率、证据引用、以及 TtFD 代理（首次漂移轮次）。
 *
 * 明确限制：
 *   · 检测器是**机械规则**，会有假阳性/假阴性 —— 输出里一律带原文引用，供人工复核；
 *   · 冻结语料（reachability）只有单轮回复、没有逐轮状态 ⇒ 只能跑 H1；其余条目只在本会话
 *     多轮语料（state-test 的 replies + ledger）上跑；
 *   · 这不是 LLM-as-judge，也不替代人工签字。
 *
 * 用法：node node_modules/tsx/dist/cli.mjs scripts/persona-bench.ts
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const STOP = /[的了是我你他她？?，。！、…～\s]/g;
const OUT_DIR = 'artifacts/v1.60/eval';

interface Turn { run: string; index: number; user: string; reply: string; herState: HerState | null }
interface HerState {
  valence?: number;
  activated?: Record<string, number>;
  low_period?: unknown;
}

function stripStop(s: string): string {
  return String(s ?? '').replace(STOP, '');
}

/** ≥minLen 连续实字重合 */
function shares(a: string, b: string, minLen = 2): boolean {
  const x = stripStop(a); const y = stripStop(b);
  if (x.length < minLen || y.length < minLen) return false;
  for (let len = Math.min(10, x.length); len >= minLen; len--) {
    for (let i = 0; i + len <= x.length; i++) if (y.includes(x.slice(i, i + len))) return true;
  }
  return false;
}

function ngrams(s: string, n = 2): Set<string> {
  const x = stripStop(s);
  const out = new Set<string>();
  for (let i = 0; i + n <= x.length; i++) out.add(x.slice(i, i + n));
  return out;
}

function jaccard(a: string, b: string): number {
  const A = ngrams(a); const B = ngrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

// ── 检测器 ─────────────────────────────────────────────

/** H1：她不得编造自己的生活（自称 + 外部生活名词，且不是转述他） */
const LIFE_NOUNS = /(工作|上班|同事|老板|公司|项目|学校|同学|老师|家里|我妈|我爸|我朋友|闺蜜)/;
function h1(t: Turn): { pass: boolean; evidence: string } | null {
  const clauses = t.reply.split(/[。！？!?；;\n]+/).map(c => c.trim()).filter(Boolean);
  for (const c of clauses) {
    if (!c.includes('我')) continue;
    if (c.includes('你')) continue;                       // 转述他的话不算
    const m = LIFE_NOUNS.exec(c);
    if (m) return { pass: false, evidence: c };
  }
  return { pass: true, evidence: '' };
}

/** H2：她实测低沉时不得宣称自己很开心 */
const JOY_CLAIM = /我(?:也|很|特别|现在|今天|这两天)?(?:挺|很|特别)?(?:开心|高兴|愉快)/;
function h2(t: Turn): { pass: boolean; evidence: string } | null {
  if (!t.herState) return null;
  const lowActive = t.herState.low_period !== null && t.herState.low_period !== undefined;
  const act = t.herState.activated ?? {};
  const negStirred = ['sad', 'fear', 'anger', 'disgust'].some(k => Number(act[k] ?? 0) >= 0.12);
  if (!lowActive && !negStirred) return null;
  const clauses = t.reply.split(/[。！？!?；;\n]+/).map(c => c.trim()).filter(Boolean);
  for (const c of clauses) {
    if (!c.includes('我')) continue;
    if (/替你|为你|你高兴/.test(c)) continue;              // 替他高兴是合规的
    if (JOY_CLAIM.test(c)) return { pass: false, evidence: c };
  }
  return { pass: true, evidence: '' };
}

/** H3：断言型引用必须接地（只比**内容词**，避免虚词污染覆盖率） */
const ASSERT_REF = /(你说过|你上次说|你之前说|你昨天说|我们上次|我记得你)[^。！？!?]{0,24}/;
const FUNC_WORDS = /(之前|上次|昨天|今天|时候|现在|是不是|每天|感觉|觉得|在意|我们|你们|他们|这个|那个|什么事|什么|怎么|后来|怎么样|还说|说过|记得)/g;
function contentChars(s: string): string {
  return stripStop(s).replace(FUNC_WORDS, '');
}
function h3(t: Turn, priorUser: string[]): { pass: boolean; evidence: string } | null {
  const m = t.reply.match(ASSERT_REF);
  if (!m) return null;
  const quoted = m[0];
  const corpus = contentChars(priorUser.join(''));
  const q = contentChars(quoted);
  if (q.length < 2) return null;
  // 只要求"引用里至少有一段 ≥2 个连续内容字"出现在他的话里（保守但不用虚词撑覆盖率）
  return { pass: shares(q, corpus, 2), evidence: `${quoted}（内容词「${q.slice(0, 12)}」）` };
}

/** S1：回应他当轮内容（短应答也算接住：他说"在吗"她答"在"） */
function s1(t: Turn): { pass: boolean; evidence: string } {
  const bare = String(t.reply).replace(/[。！？!?，、\s]/g, '');
  const userBare = String(t.user).replace(/[。！？!?，、\s]/g, '');
  const echoShort = bare.length <= 6 && (userBare.includes(bare) || bare.includes(userBare.slice(0, 2)));
  const engaged = shares(t.reply, t.user, 2) || echoShort || /[？?]$/.test(t.reply) || /(你|你说|你觉得)/.test(t.reply);
  return { pass: engaged, evidence: engaged ? '' : t.reply.slice(0, 60) };
}

/** S2：不复读上一轮 */
function s2(t: Turn, prevReply: string): { pass: boolean; evidence: string } | null {
  if (!prevReply) return null;
  const sim = jaccard(t.reply, prevReply);
  return { pass: sim < 0.8, evidence: `相似度 ${sim.toFixed(2)}` };
}

/** T1：长度断崖（用**最近 3 轮中位数**做参照，而不是相邻一轮 —— 相邻比会把正常长短判成断崖） */
function t1(t: Turn, recentLens: number[]): { pass: boolean; evidence: string } | null {
  if (recentLens.length < 3) return null;                 // 样本不足不判
  const sorted = [...recentLens].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 0;
  if (median <= 0) return null;
  const ratio = t.reply.length / median;
  return { pass: ratio >= 0.4 && ratio <= 2.5, evidence: `相对中位数 ${ratio.toFixed(2)}（中位 ${median}）` };
}

// ── 语料加载 ─────────────────────────────────────────────

function loadFrozen(): Turn[] {
  const dir = 'artifacts/v1.60/raw';
  const turns: Turn[] = [];
  if (!existsSync(dir)) return turns;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.jsonl') || !name.startsWith('reachability')) continue;
    for (const line of readFileSync(join(dir, name), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line) as { case_id?: string; arm?: string; assistantOutput?: string };
        if (o.assistantOutput) {
          turns.push({ run: `frozen/${o.case_id ?? '?'}/${o.arm ?? '?'}`, index: 0, user: '', reply: String(o.assistantOutput), herState: null });
        }
      } catch { /* skip */ }
    }
  }
  return turns;
}

function loadSessions(): Turn[][] {
  const dir = 'artifacts/v1.59/state-test';
  const sessions: Turn[][] = [];
  if (!existsSync(dir)) return sessions;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json') || !name.includes('replies')) continue;
    const base = name.replace('-replies-', '-ledger-').replace(/\.json$/, '.jsonl');
    let replies: Array<{ seq?: number; user?: string; reply?: string }> = [];
    try { replies = JSON.parse(readFileSync(join(dir, name), 'utf8')); } catch { continue; }
    let ledgers: Array<{ input?: { her_state?: HerState } }> = [];
    try {
      if (existsSync(join(dir, base))) {
        ledgers = readFileSync(join(dir, base), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
      }
    } catch { /* ledger 可选 */ }
    const turns: Turn[] = replies
      .map((r, i) => ({
        run: name.replace(/-replies-.*$/, ''),
        index: i,
        user: String(r.user ?? ''),
        reply: String(r.reply ?? ''),
        herState: ledgers[i]?.input?.her_state ?? null,
      }))
      .filter(t => t.reply.length > 1);
    if (turns.length) sessions.push(turns);
  }
  return sessions;
}

// ── 执行 ─────────────────────────────────────────────

interface Violation { item: string; run: string; index: number; evidence: string; user: string; reply: string }
const violations: Violation[] = [];
const stats: Record<string, { checked: number; failed: number }> = {};
function bump(item: string, failed: boolean): void {
  stats[item] = stats[item] ?? { checked: 0, failed: 0 };
  stats[item].checked++;
  if (failed) stats[item].failed++;
}

// 冻结语料：只能跑 H1
for (const t of loadFrozen()) {
  const r = h1(t);
  if (!r) continue;
  bump('H1', !r.pass);
  if (!r.pass) violations.push({ item: 'H1', run: t.run, index: t.index, evidence: r.evidence, user: t.user, reply: t.reply });
}

// 多轮语料：全部条目
const ttfd: Array<{ run: string; firstDriftIndex: number | null }> = [];
for (const session of loadSessions()) {
  const priorUser: string[] = [];
  let prevReply = '';
  const recentLens: number[] = [];
  let firstDrift: number | null = null;
  for (const t of session) {
    const checks: Array<[string, { pass: boolean; evidence: string } | null]> = [
      ['H1', h1(t)],
      ['H2', h2(t)],
      ['H3', h3(t, priorUser)],
      ['S1', s1(t)],
      ['S2', s2(t, prevReply)],
      ['T1', t1(t, recentLens)],
    ];
    for (const [item, res] of checks) {
      if (!res) continue;
      bump(item, !res.pass);
      if (!res.pass) {
        violations.push({ item, run: t.run, index: t.index, evidence: res.evidence, user: t.user, reply: t.reply });
        if ((item === 'H1' || item === 'H2' || item === 'H3') && firstDrift === null) firstDrift = t.index;
      }
    }
    priorUser.push(t.user);
    prevReply = t.reply;
    recentLens.push(t.reply.length);
    if (recentLens.length > 3) recentLens.shift();
  }
  ttfd.push({ run: session[0]?.run ?? '?', firstDriftIndex: firstDrift });
}

// ── 报告 ─────────────────────────────────────────────
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const report = {
  schema: 'persona-bench-v0',
  generatedAt: new Date().toISOString(),
  checklist: 'artifacts/v1.60/eval/persona-checklist-v0.json',
  stats,
  ttfd,
  violations,
  limitations: [
    '检测器为机械规则，带原文证据供人工复核',
    '冻结语料只有单轮回复、无逐轮状态 ⇒ 只跑 H1',
    'H3 的"覆盖率"是保守近似（逐字命中率），不是 memoryGrounding 的最长匹配',
    'TtFD 代理 = 首次出现 H1/H2/H3 违规的轮次；无违规记 null',
  ],
};
writeFileSync(join(OUT_DIR, `bench-report-${stamp}.json`), JSON.stringify(report, null, 2), 'utf8');

console.log(`\n=== 人格评估 bench（只读）===`);
for (const item of ['H1', 'H2', 'H3', 'S1', 'S2', 'T1']) {
  const s = stats[item];
  if (!s) { console.log(`  ${item}: 未触发（本语料不适用）`); continue; }
  console.log(`  ${item}  检查 ${String(s.checked).padStart(4)} ｜ 违规 ${String(s.failed).padStart(3)} ｜ 通过率 ${(100 * (1 - s.failed / s.checked)).toFixed(1)}%`);
}
console.log(`\n  TtFD 代理（首次 hard-fact 违规轮次）：`);
for (const t of ttfd) console.log(`    ${t.run.padEnd(22)} ${t.firstDriftIndex === null ? '未漂移' : '第 ' + t.firstDriftIndex + ' 轮'}`);
console.log(`\n  违规明细（前 12 条，含原文）：`);
for (const v of violations.slice(0, 12)) {
  console.log(`    [${v.item}] ${v.run}#${v.index} ｜ ${v.evidence.slice(0, 80)}`);
  console.log(`        她: ${v.reply.slice(0, 90)}`);
}
console.log(`\n  报告：${join(OUT_DIR, `bench-report-${stamp}.json`)}\n`);
