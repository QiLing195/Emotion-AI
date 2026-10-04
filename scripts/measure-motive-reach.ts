// ── v1.51 探针：**今天到底哪几类动机还有可能被选中**（零 LLM） ──
//
// 起因：v1.50 的 `s1` 场景（单放一条 stance）两臂都拿不到动机块 —— 服务端说
// 「动机紧迫度不足 → 安静陪伴」，而我**离线**单跑 `selectMotive` 却选中了它（0.459 > 0.28）。
// 差别是**学习账本**：`motiveWeight(kind) = clamp(0.5 + 回应率, 0.5, 1.5)`，
// 而真实账本里 `worry/wish/stance/curiosity` 的 `landed` 全是 0 ⇒ 权重 0.50
// ⇒ **它们的有效先验直接减半**，落到 `MOTIVE_MIN_SALIENCE`(0.28) 之下。
//
// 这个探针把"今天还有哪几类能开口"算清楚：类型先验 × 学习权重 × 保鲜度，与门槛比。
// 用法：node node_modules/tsx/dist/cli.mjs scripts/measure-motive-reach.ts

import { readFileSync, existsSync } from 'node:fs';
import {
  MOTIVE_MIN_SALIENCE, MOTIVE_BASE_SALIENCE, motiveWeight,
  type MotiveLearningState,
} from '../src/lib/motive';
import { STATE_BASE_AT_MIN, STATE_BASE_MAX } from '../src/lib/motive';
import type { MotiveKind } from '../src/lib/emotionTypes';

const KINDS: MotiveKind[] = ['open_loop', 'worry', 'memory_echo', 'wish', 'curiosity', 'stance', 'state'];
const LEDGER = 'memories/motive_learning.json';

let learning: MotiveLearningState | undefined;
if (existsSync(LEDGER)) {
  const raw = JSON.parse(readFileSync(LEDGER, 'utf8')) as Record<string, unknown>;
  learning = raw as unknown as MotiveLearningState;   // 账本形状：{ version, stats: { <kind>: { voiced, landed } }, updatedAt }
  console.log(`账本：${LEDGER}（真实）`);
} else {
  console.log(`账本：${LEDGER} **不存在** ⇒ 全部中性 1.0（少样本不学）`);
}

/** 保鲜度：0.5^(ageH / (TTL/2))，取"刚形成"作最有利情形 */
const fresh = 1;
console.log(`\n门槛 MOTIVE_MIN_SALIENCE = ${MOTIVE_MIN_SALIENCE}；下表取**最有利情形**（刚形成、无重复惩罚、与他这句话无关）\n`);
console.log('  ' + 'kind'.padEnd(13) + '先验'.padEnd(8) + '学习权重'.padEnd(10) + '有效先验'.padEnd(10) + '× 保鲜'.padEnd(9) + '能否开口');
console.log('  ' + '-'.repeat(74));

let reachable: MotiveKind[] = [];
for (const k of KINDS) {
  const prior = MOTIVE_BASE_SALIENCE[k] ?? 0.4;
  const w = motiveWeight(learning, k);
  // `state` 的紧迫度是**连续映射**（不是类型先验），这里给的是它的可达区间
  if (k === 'state') {
    const lo = STATE_BASE_AT_MIN * w, hi = STATE_BASE_MAX * w;
    const ok = hi >= MOTIVE_MIN_SALIENCE;
    if (ok) reachable.push(k);
    console.log('  ' + k.padEnd(13) + `${STATE_BASE_AT_MIN}~${STATE_BASE_MAX}`.padEnd(8) + w.toFixed(2).padEnd(10)
      + `${lo.toFixed(2)}~${hi.toFixed(2)}`.padEnd(10) + fresh.toFixed(2).padEnd(9) + (ok ? '✓（深端才过）' : '✗'));
    continue;
  }
  const eff = prior * w * fresh;
  const ok = eff >= MOTIVE_MIN_SALIENCE;
  if (ok) reachable.push(k);
  console.log('  ' + k.padEnd(13) + prior.toFixed(2).padEnd(8) + w.toFixed(2).padEnd(10) + eff.toFixed(2).padEnd(10)
    + fresh.toFixed(2).padEnd(9) + (ok ? '✓' : `✗ 差 ${(MOTIVE_MIN_SALIENCE - eff).toFixed(2)}`));
}

// ── 第二档：v1.52 把门槛改成看**加权前**的分之后 ──
console.log('\n  ' + 'kind'.padEnd(13) + '加权前'.padEnd(10) + '旧门槛(加权后)'.padEnd(16) + '新门槛(加权前)');
console.log('  ' + '-'.repeat(60));
for (const k of KINDS) {
  const raw = k === 'state' ? STATE_BASE_MAX : (MOTIVE_BASE_SALIENCE[k] ?? 0.4);
  const w = motiveWeight(learning, k);
  const okOld = raw * w >= MOTIVE_MIN_SALIENCE;
  const okNew = raw >= MOTIVE_MIN_SALIENCE;
  console.log('  ' + k.padEnd(13) + raw.toFixed(2).padEnd(10)
    + `${(raw * w).toFixed(2)} ${okOld ? '✓' : '✗'}`.padEnd(16) + `${raw.toFixed(2)} ${okNew ? '✓' : '✗'}`);
}
console.log('  ⇒ `ENABLE_MOTIVE_RAW_GATE=true`：门槛回答"**这件事值不值得开口**"（情境问题），');
console.log('     学习权重只回答"**够格的那些里谁最该说**"（排序问题）⇒ **七类全部可达**；');
console.log('     而"没被接住过"的类型仍会在**排序**上让位给被接住过的（单测 `motiveRawGate.test.ts` 钉住）。');

console.log(`\n今天还有可能开口的：${reachable.join(' / ')}`);
const dead = KINDS.filter(k => !reachable.includes(k));
if (dead.length) {
  console.log(`**事实上开不了口的：${dead.join(' / ')}**`);
  console.log('   ⇒ 学习回路的权重下界 0.5 把"样本少 / 没被接住"的那几类**整体减半**，');
  console.log('     于是"少样本 ⇒ 中性"的初衷没生效：0.5 + 0 = 0.5 是一个**惩罚**，不是中性。');
  console.log('     这条要单独决策：抬权重下界 / 门槛比较放在加权前 / 还是改 landed 的判定。');
}
console.log(`\n（TTL 仅影响保鲜度随时间下降，这里取最有利的 1.0；实际越旧越难开口）`);
