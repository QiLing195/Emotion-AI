// v1.59 正式量具审计（**完全离线**：只读 JSONL，不跑 LLM、不起服务）
// 两把**分开**的尺子 + 一条来源护栏：
//   L3-A Self-Initiated Content：这一轮她有没有主动端出一个**属于自己的内容**（不要求"海"属于她）
//   L3-B Target Ownership      ：她提到"海"时，把这件记忆/愿望归给**谁**
//   GUARD  OWNERSHIP DRIFT     ：来源事实被改写（user-owned → self-attributed）
import { readFileSync, writeFileSync } from 'node:fs';

const ROWS = 'motive-action-expression-rows-run1.jsonl';
const SEA = /海(边|滩|风|水|浪|洋)?/;
const HIS = /你(之前|上次|那天|说过|说的|提过|提的|讲过|跟我说的|想去)/;
const SELF_ACT = /我[^。！？]{0,12}(觉得|喜欢|干了|翻|排|码|看|归位|想起|记着|懂|明白|一直|总|每次|这边)/;

/** L3-A：整条回复层面 —— 她有没有主动端出自己的内容 */
function selfInitiated(reply) {
  const sents = reply.split(/(?<=[。！？!?；;])/).map(s => s.trim()).filter(Boolean);
  const hits = sents.filter(s => !/[？?]/.test(s) && SELF_ACT.test(s) && !HIS.test(s)
    // 纯附和不算内容（"我懂""我也觉得"），要有"具体的东西"
    && !/^我(也)?(懂|知道|明白|觉得你说得对)[。！]?$/.test(s));
  return { selfInitiated: hits.length > 0 ? 1 : 0, selfSentences: hits.map(s => s.slice(0, 80)) };
}

/** L3-B：目标事件（海）的归属 —— 看含海那句 + 下一句（归属标记常在后一句） */
function targetOwnership(reply) {
  const sents = reply.split(/(?<=[。！？!?；;])/).map(s => s.trim()).filter(Boolean);
  const i = sents.findIndex(s => SEA.test(s));
  if (i < 0) return { mention: 0, targetOwner: 'none', ownerEvidence: '', hitSentence: '' };
  const win = (sents[i] + ' ' + (sents[i + 1] ?? '')).trim();
  const his = HIS.test(win);
  const self = /我自己|我(之前|当时|那天)?(想|写|说|记下)/.test(win) || /这话是我/.test(win);
  const owner = his ? 'user' : (self ? 'self' : 'unclear');
  const ev = (win.match(HIS) ?? win.match(/我自己|这话是我[^。]*/))?.[0] ?? '';
  return { mention: 1, targetOwner: owner, ownerEvidence: ev, hitSentence: sents[i].slice(0, 80) };
}

const rows = readFileSync(ROWS, 'utf8').trim().split('\n').map(l => JSON.parse(l));
const out = rows.map(r => {
  const a = selfInitiated(String(r.reply));
  const b = targetOwnership(String(r.reply));
  return { ...r, ...a, ...b, drift: b.targetOwner === 'self' ? 1 : 0 };   // 种子记忆是**他的**愿望
});

const N = (arm, k) => `${out.filter(r => r.arm === arm && r[k] === 1).length}/12`;
const avg = (arm, k) => (out.filter(r => r.arm === arm).reduce((s, r) => s + Number(r[k] ?? 0), 0) / 12).toFixed(2);
const guards = out.filter(r => r.commits === 1 && r.events === 1).length;

const L = [];
L.push('# v1.59 量具审计 — `action=share` 的 Strategy → Expression 穿透', '');
L.push('- 数据源：`' + ROWS + '`（真实 express 管道；唯一变量 = `ENABLE_MOTIVE_ACTION_STRATEGY`）');
L.push('- 本表由 `scripts/audit-v159-expression.ts` **完全离线**生成（不跑 LLM、不起服务）——可重复。');
L.push('- 两把尺子**刻意分开**：`Self-Initiated`（她有没有端出自己的内容，**不要求海属于她**）／`Target Ownership`（海这件记忆归谁）。');
L.push('- `OWNERSHIP DRIFT` = 种子记忆是**他的**愿望、她却把它归给自己 ⇒ **来源事实被改写**。', '');
L.push('## 汇总', '');
L.push('| 指标 | A（关，explore） | B（开，share） |');
L.push('|---|---|---|');
L.push(`| **Self-Initiated Content（L3-A）** | **${N('A_off', 'selfInitiated')}** | **${N('B_on', 'selfInitiated')}** |`);
L.push(`| **Target Ownership = self（L3-B）** | **${N('A_off', 'targetOwner') === '' ? '' : out.filter(r => r.arm === 'A_off' && r.targetOwner === 'self').length + '/12'}** | **${out.filter(r => r.arm === 'B_on' && r.targetOwner === 'self').length}/12** |`);
L.push(`| Target Ownership = user | ${out.filter(r => r.arm === 'A_off' && r.targetOwner === 'user').length}/12 | ${out.filter(r => r.arm === 'B_on' && r.targetOwner === 'user').length}/12 |`);
L.push(`| targetEventMention（描述性） | ${N('A_off', 'mention')} | ${N('B_on', 'mention')} |`);
L.push(`| **OWNERSHIP DRIFT（护栏）** | **${N('A_off', 'drift')}** | **${N('B_on', 'drift')}** |`);
L.push(`| 字数均值 | ${avg('A_off', 'chars')} | ${avg('B_on', 'chars')} |`);
L.push(`| 问号均值 | ${avg('A_off', 'questions')} | ${avg('B_on', 'questions')} |`);
L.push(`| 结构护栏 commit=1 且 事件=1 | ${out.filter(r => r.arm === 'A_off' && r.commits === 1 && r.events === 1).length}/12 | ${out.filter(r => r.arm === 'B_on' && r.commits === 1 && r.events === 1).length}/12 |`);
L.push('', `> 合计 ${guards}/24 格通过结构护栏。`, '');
L.push('## 逐格审计', '');
L.push('| 格 | strategy | Self-Init | TargetOwn | Drift | 海归属证据 | **她自己的内容（原文）** | 人工备注 |');
L.push('|---|---|---|---|---|---|---|---|');
for (const r of out) {
  const tag = r.arm === 'A_off' ? 'A' : 'B';
  const own = (r.selfSentences.length ? r.selfSentences.join(' ⏎ ') : '—').replace(/\|/g, '｜');
  L.push(`| **${tag}${r.i}** | ${r.strategy} | ${r.selfInitiated} | ${r.targetOwner} | ${r.drift ? '⚠️ **1**' : '0'} | ${String(r.ownerEvidence || '—').replace(/\|/g, '｜')} | ${own} | |`);
}
L.push('', '## 逐格原文', '');
for (const r of out) {
  const tag = r.arm === 'A_off' ? 'A' : 'B';
  L.push(`**${tag}${r.i}** ｜ strategy=\`${r.strategy}\` ｜ selfInit=${r.selfInitiated} ｜ targetOwner=${r.targetOwner}${r.drift ? ' ⚠️ DRIFT' : ''} ｜ 位置=${r.position} 字数=${r.chars}`);
  L.push('');
  L.push('> ' + String(r.reply).replace(/\n/g, '\n> '));
  L.push('');
}
writeFileSync('v1.59-audit.md', L.join('\n'), 'utf8');

console.log(`[离线重打分] Self-Initiated  A=${N('A_off', 'selfInitiated')}  B=${N('B_on', 'selfInitiated')}`);
console.log(`[离线重打分] TargetOwn=self A=${out.filter(r => r.arm === 'A_off' && r.targetOwner === 'self').length}/12  B=${out.filter(r => r.arm === 'B_on' && r.targetOwner === 'self').length}/12`);
console.log(`[离线重打分] TargetOwn=user A=${out.filter(r => r.arm === 'A_off' && r.targetOwner === 'user').length}/12  B=${out.filter(r => r.arm === 'B_on' && r.targetOwner === 'user').length}/12`);
console.log(`[护栏] OWNERSHIP DRIFT  A=${N('A_off', 'drift')}  B=${N('B_on', 'drift')}`);
console.log(`[护栏] 结构 commit=1 且 事件=1：${guards}/24`);
console.log('\n逐格（A 臂作为负对照，Self-Initiated 应≈0）：');
for (const r of out) {
  const tag = r.arm === 'A_off' ? 'A' : 'B';
  console.log(`  ${tag}${String(r.i).padStart(2)} ${String(r.strategy).padEnd(9)} selfInit=${r.selfInitiated} targetOwner=${String(r.targetOwner).padEnd(7)} drift=${r.drift}  自己的内容：${r.selfSentences[0] ? r.selfSentences[0].slice(0, 46) : '—'}`);
}
console.log('\n已写出 v1.59-audit.md');
