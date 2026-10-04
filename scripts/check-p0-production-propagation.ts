// P0-1 第 2 件：**生产行为证据** —— 真实 `resolveTurnMotive()` 里 memory_echo 被**选中**并保住 provenance。
//
// 与结构证据（`check-p0-selectmotive-retention.ts`）**分开**：那一件证"字段不会在入选时丢"，
// 这一件证"生产入口真的把 memory_echo 选出来了、字段还在"。
//
// fixture 纪律（只动 fixture，不动生产规则）：
//   ✓ 固定实验状态、注入唯一 memory_echo 候选（经 `proactiveDecision` 走**生产工厂**）
//   ✓ 清掉竞争来源（pool / pendingCandidates / valuePriorities）—— 这是**装置**，不是改优先级
//   ✗ 不改 argmax、不给 memory_echo 加分、不绕过 `resolveTurnMotive()`、不手搓最终 Motive
import { resolveTurnMotive } from '../server/services/turnMotive.js';
import { getMotiveLearning } from '../server/persistence.js';
import { RESTING_EMOTION_BASELINE } from '../src/lib/emotionActivation.js';

let assertionCount = 0;
const failures: string[] = [];
function check(cond: boolean, msg: string, got?: unknown): void {
  assertionCount += 1;
  if (cond) console.log('   ✓ ' + msg);
  else { failures.push(msg); console.log('   ✗ ' + msg + ' ｜ 实际=' + JSON.stringify(got)); }
}

const MEMORY_ID = 'ep_sea';
const SUMMARY = '他说等这个项目结束，想去趟海边';
const now = Date.now();
// 固定实验状态：唯一候选来自 proactiveDecision；三个竞争来源**清空**（装置，不是规则）
const state = {
  emotions: { ...RESTING_EMOTION_BASELINE },
  baselineEmotions: { ...RESTING_EMOTION_BASELINE },
  internal: { mood: { valence: -0.06, arousal: 0.45, anchorValence: 0.2, updatedAt: now, samples: 6 }, motive: { pool: [], pendingCandidates: [] } },
  evolution: { valuePriorities: {} },
} as never;

const out = resolveTurnMotive({
  currentEmotionState: state,
  updatedEmotionState: state,
  userText: '今天下午把阳台收拾了一下，累是累，看着还行。',
  recentMessages: [{ role: 'user', content: '早' }],
  herNegativeBeforeTurn: { emotion: 'calm', intensity: 0 },
  userAnalysis: { intensity: 0.2, expressedEmotion: 'neutral', directedAtAI: false } as never,
  proactiveDecision: { memory: { id: MEMORY_ID, eventSummary: SUMMARY }, injectionText: '【记忆】' + SUMMARY },
  learning: getMotiveLearning(),
  now: Date.now(),
});
const s = out.selected;
console.log('   [生产入口] selected = ' + JSON.stringify(s ? { kind: s.kind, memoryId: s.memoryId, provenance: s.provenance } : null));

check(!!s, 'resolveTurnMotive() 选出了动机（单候选 fixture）', out);
check(s?.kind === 'memory_echo', '被选中的是 memory_echo（生产入口真的选中了它）', s?.kind);
check(s?.memoryId === MEMORY_ID, 'selected.memoryId = ep_sea', s?.memoryId);
check(s?.provenance?.owner === 'user', 'selected.provenance.owner = user', s?.provenance);
check(s?.provenance?.source === 'user_message', 'selected.provenance.source = user_message', s?.provenance);
check(s?.provenance?.subject === 'user', 'selected.provenance.subject = user', s?.provenance);
check(s?.provenance?.evidenceId === MEMORY_ID, 'selected.provenance.evidenceId = ep_sea', s?.provenance);
// 反向约束：没有 memory 的 proactiveDecision ⇒ 不该出现 memory_echo
const out2 = resolveTurnMotive({
  currentEmotionState: state, updatedEmotionState: state, userText: '嗯', recentMessages: [],
  herNegativeBeforeTurn: { emotion: 'calm', intensity: 0 },
  userAnalysis: { intensity: 0, expressedEmotion: 'neutral', directedAtAI: false } as never,
  proactiveDecision: null, learning: getMotiveLearning(), now: Date.now(),
});
check(out2.selected?.kind !== 'memory_echo', '没有主动回忆 ⇒ 不应凭空出现 memory_echo', out2.selected?.kind);

console.log('\nASSERTIONS: ' + (assertionCount - failures.length) + '/' + assertionCount);
console.log('RESULT: ' + (failures.length === 0 ? 'PASS' : 'FAIL'));
if (failures.length) { console.log('未通过：\n  - ' + failures.join('\n  - ')); process.exit(1); }
