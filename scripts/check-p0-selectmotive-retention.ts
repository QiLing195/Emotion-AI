// P0-1 微步：**结构保持**证据 —— `candidate → selectMotive() → selected` 不丢 provenance。
//
// ⚠️ 边界（刻意）：这是**结构证据**，不是"生产路径已验证"。
//    生产行为证据（真实 memory_echo 被 argmax 选中）仍是 ⏳ —— 上一次 live run 里 stance 抢走了入选位。
//    证据必须分开保留，不许混。
//
// 为什么直调 `selectMotive()`：只验证"字段会不会在入选时丢"，所以**不让**情绪池 / stance /
// valuePriorities / 学习权重等任何其它机制参与。
import { selectMotive } from '../src/lib/motive.js';
import { provenanceForUserMemory } from '../src/lib/memoryProvenance.js';
import type { MotiveCandidate } from '../src/lib/motive.js';
import type { MotiveState, MotiveLearningState } from '../src/lib/emotionTypes.js';

// 计数器**自己数**（上一版硬编码 N_ASSERT=9 而实际 10 条 ⇒ 假报告，已修）
let assertionCount = 0;
const failures: string[] = [];
function check(condition: boolean, message: string, got?: unknown): void {
  assertionCount += 1;
  if (condition) console.log(`   ✓ ${message}`);
  else { failures.push(message); console.log(`   ✗ ${message} ｜ 实际=${JSON.stringify(got)}`); }
}

const MEMORY_ID = 'ep_sea';
const candidate: MotiveCandidate = {
  kind: 'memory_echo',
  content: '我想起他说过「等这个项目结束，我想去趟海边」',
  source: { memoryId: MEMORY_ID },
  memoryId: MEMORY_ID,
  provenance: provenanceForUserMemory(MEMORY_ID),
};

const pool: MotiveState = { pool: [] };          // 空池：只有**这一个**候选参与竞争
let learning: MotiveLearningState;
try { learning = { version: 1, updatedAt: Date.now(), stats: {} }; }
catch { learning = {} as MotiveLearningState; }

const out = selectMotive({
  state: pool,
  candidates: [candidate],
  userText: '今天下午把阳台收拾了一下，累是累，看着还行。',
  herNegativeBeforeTurn: { emotion: 'calm', intensity: 0 },
  userIntensity: 0,
  userEmotion: undefined,
  learning,
  now: Date.now(),
} as never);

const sel = out.selected;
console.log(`   [结构] selected = ${JSON.stringify(sel ? { kind: sel.kind, memoryId: sel.memoryId, provenance: sel.provenance } : null)}`);

check(!!sel, 'selectMotive 返回了 selected（单候选不应为空）', out);
check(sel?.kind === 'memory_echo', 'selected.kind 保持 memory_echo', sel?.kind);
check(sel?.memoryId === MEMORY_ID, 'selected.memoryId 保持 ep_sea', sel?.memoryId);
check(sel?.provenance?.owner === 'user', 'selected.provenance.owner 保持 user', sel?.provenance);
check(sel?.provenance?.source === 'user_message', 'selected.provenance.source 保持 user_message', sel?.provenance);
check(sel?.provenance?.subject === 'user', 'selected.provenance.subject 保持 user', sel?.provenance);
check(sel?.provenance?.evidenceId === MEMORY_ID, 'selected.provenance.evidenceId 保持 ep_sea', sel?.provenance);
// 反证：换一个**没有** provenance 的候选，selected 也必须**不伪造**
const bare = selectMotive({
  state: { pool: [] }, candidates: [{ kind: 'memory_echo', content: candidate.content, source: { memoryId: MEMORY_ID } }],
  userText: '嗯', herNegativeBeforeTurn: { emotion: 'calm', intensity: 0 }, userIntensity: 0, learning, now: Date.now(),
} as never).selected;
check(bare?.provenance === undefined, '没有 provenance 的候选 ⇒ selected 也**不伪造**（undefined）', bare?.provenance);

console.log(`\nASSERTIONS: ${assertionCount - failures.length}/${assertionCount}`);
console.log(`RESULT: ${failures.length === 0 ? 'PASS' : 'FAIL'}`);
if (failures.length) { console.log('未通过：\n  - ' + failures.join('\n  - ')); process.exit(1); }
