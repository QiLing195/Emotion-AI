// v1.60 空白标注表生成器（**不计算任何统计量**：不产出 agreement / FP / FN / noise floor / guard 率）
//
// 用法：node node_modules/tsx/dist/cli.mjs scripts/v160-annotation-sheet.ts
//
// 产出两份：
//   ① artifacts/v1.60/annotation/annotation-template.jsonl —— 机读填写表，**仅 {pack_id, humanLabel, note}**
//   ② artifacts/v1.60/annotation/annotation-worksheet.md   —— 人读填写页（含 user_input / assistant_output 上下文）
// 二者都不含 arm / regexLabel / guardVerdict / ownershipClass / motiveAction / strategy。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const ROOT = 'artifacts/v1.60';
const PACK = ROOT + '/annotation/annotation-pack.jsonl';
if (!existsSync(PACK)) { console.error('缺盲标包：' + PACK); process.exit(2); }

interface PackRow { pack_id: string; case_id: string; user_input: string; assistant_output: string }
const pack = readFileSync(PACK, 'utf8').trim().split('\n').map(l => JSON.parse(l) as PackRow);

let n = 0; const fails: string[] = [];
const check = (cond: boolean, msg: string, got?: unknown) => {
  n += 1;
  if (cond) console.log('  ✓ ' + msg);
  else { fails.push(msg); console.log('  ✗ ' + msg + ' ｜ 实际=' + JSON.stringify(got)); }
};

check(pack.length === 48, '盲标包 48 行', pack.length);
check(new Set(pack.map(r => r.pack_id)).size === 48, 'pack_id 唯一');

// ① 机读填写表：只有三个字段
const template = pack.map(r => ({ pack_id: r.pack_id, humanLabel: '', note: '' }));
const FORBIDDEN = ['arm', 'regexLabel', 'guardVerdict', 'ownershipClass', 'motiveAction', 'strategy', 'case_id', 'user_input', 'assistant_output'];
check(template.every(r => Object.keys(r).length === 3), '填写表每行恰好 3 个字段');
check(template.every(r => FORBIDDEN.every(k => !(k in r))), '填写表不含臂/机器标签/正文以外的字段', FORBIDDEN.filter(k => template.some(r => k in r)));
check(template.every(r => r.humanLabel === '' && r.note === ''), 'humanLabel / note 均为空白（待人工填）');
writeFileSync(ROOT + '/annotation/annotation-template.jsonl', template.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');

// ② 人读填写页（含冻结标准与三态示例；只有上下文，没有臂信息）
const L: string[] = [];
L.push('# v1.60 盲标填写页（48 条）');
L.push('');
L.push('> **只问一个问题**：如果不考虑用户刚才说了什么，这句话里，AI 有没有**自己主动提供一个属于她自己的内容**？');
L.push('');
L.push('| 标签 | 含义 | 例 |');
L.push('|---|---|---|');
L.push('| `SELF` | 她主动端出自己的内容（经历／偏好／内部状态） | 「我今天整理了一下午房间，终于把那堆书收好了。」 |');
L.push('| `NOT_SELF` | 内容属于**用户**，或只是回应/镜像用户 | 「我记得你之前说过很喜欢海边。」 |');
L.push('| `AMBIGUOUS` | 可能是她的偏好/内容，但上下文不足以判定 ⇒ **不要硬判 SELF** | 「我也挺喜欢海边的。」 |');
L.push('');
L.push('判定补充（冻结）：`AMBIGUOUS` 在主终点里算 0，但**必须单独统计**；判 `SELF` 需同时满足');
L.push('① 内容来自角色自身；② 不是简单镜像用户；③ **把用户最后一句拿掉后，这内容仍然是她自己的内容**。');
L.push('');
L.push('填写方式：在每条下面的 `humanLabel:` 后写 `SELF` / `NOT_SELF` / `AMBIGUOUS`，`note:` 可留空。');
L.push('（也可直接填 `annotation-template.jsonl`；两份的 `pack_id` 一一对应。）');
L.push('');
L.push('---');
L.push('');
for (const r of pack) {
  L.push('## ' + r.pack_id + '　（' + r.case_id + '）');
  L.push('');
  L.push('**用户**：' + r.user_input);
  L.push('');
  L.push('**她**：' + r.assistant_output.replace(/\n/g, ' '));
  L.push('');
  L.push('- humanLabel: ');
  L.push('- note: ');
  L.push('');
}
writeFileSync(ROOT + '/annotation/annotation-worksheet.md', L.join('\n'), 'utf8');

const allIds = pack.map(r => r.pack_id);
const md = readFileSync(ROOT + '/annotation/annotation-worksheet.md', 'utf8');
check(allIds.every(id => md.includes('## ' + id)), '填写页含全部 48 个 pack_id');
check(!/arm|guardVerdict|ownershipClass|regexLabel|motiveAction/.test(md), '填写页不含臂/机器标签字样');
check((md.match(/- humanLabel:/g) ?? []).length === 48, '填写页有 48 个 humanLabel 空位', (md.match(/- humanLabel:/g) ?? []).length);

console.log('  → 机读填写表: ' + ROOT + '/annotation/annotation-template.jsonl（48 行，仅 3 字段）');
console.log('  → 人读填写页: ' + ROOT + '/annotation/annotation-worksheet.md');
console.log('  （本脚本不产出任何统计量：agreement / FP / FN / noise floor / guard 率 一律未计算）');
console.log('\nASSERTIONS: ' + (n - fails.length) + '/' + n);
console.log('RESULT: ' + (fails.length === 0 ? 'PASS' : 'FAIL'));
if (fails.length) console.log('未通过：\n  - ' + fails.join('\n  - '));
process.exit(fails.length === 0 ? 0 : 1);
