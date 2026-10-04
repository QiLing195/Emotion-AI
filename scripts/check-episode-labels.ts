// 情景记忆的情绪标签与叙事实测（v1.20）
//
// 背景：v1.13 修掉"基调冒充情绪"时，`episodicMemory` 里还剩两处**绝对值 argmax**：
//   ① 叙事情绪的兜底 `|| dominant.name`（calm 基调 0.8 → 几乎永远 'calm'）
//   ② 标签兜底 `dominant.intensity > 0.5 ? dominant.name : '日常'`（calm 恒 0.8 > 0.5 → 恒打 'calm'）
// 实测存量 41 条里 32 条（78%）`dominantEmotion = calm`，连"他说了下周要体检、有点担心"都被记成
// "安静中带着满足，这是一种踏实的幸福"。
//
// 本脚本用**真实管道**（aiCoordinator.processTurn → tryFormEpisode）跑一批真实存在过的句子，
// 并排打印"旧读法（绝对值 argmax）"与"新读法（激活态）"分别会给她记下什么。
//
// 用法: node node_modules/tsx/dist/cli.mjs scripts/check-episode-labels.ts
import { aiCoordinator } from '../server/services/aiCoordinator.js';
import { INITIAL_EMOTION_STATE, getDominantEmotion, setDeterministicMode } from '../src/lib/emotionEngine.js';
import { separateActivation } from '../src/lib/emotionActivation.js';
import { createEpisodicMemoryStore, tryFormEpisode } from '../src/lib/episodicMemory.js';
import type { EmotionState } from '../src/lib/emotionTypes.js';

setDeterministicMode(true);

interface Case { text: string; emotion: string; intensity: number; atAI?: boolean }

// 注意：`emotion/intensity` 模拟的是**线上 LLM NLU 会给出的读数**（不是本地词典）。
// 给弱读数就会得到"静息"，那是我喂进去的输入弱，不是她冷漠 —— 别把测试输入当成她的反应。
const CASES: Case[] = [
  { text: '我今天特别难过，什么都做不好', emotion: 'sad', intensity: 0.9 },
  { text: '我下周要去做一个体检，有点担心结果', emotion: 'fear', intensity: 0.7 },
  { text: '你会不会觉得我很烦', emotion: 'sad', intensity: 0.6 },
  { text: '下个月是我生日，想请你陪我一起过，你会来吗？', emotion: 'joy', intensity: 0.8, atAI: true },
  { text: '今天路上看到一只小猫，挺可爱的', emotion: 'joy', intensity: 0.4 },
  { text: '我特别喜欢在雨天一个人看电影', emotion: 'neutral', intensity: 0.2 },
  { text: '我爱你，真的离不开你', emotion: 'love', intensity: 0.9, atAI: true },
];

interface Row { text: string; oldLabel: string; newLabel: string; narrative: string; tags: string; activation: string }

const rows: Row[] = [];

for (const c of CASES) {
  // 从静息基线出发，走完整管道（传染/评价/内在事件/心情/反刍/人格漂移都照跑）
  const out = aiCoordinator.processTurn({
    userText: c.text,
    currentEmotionState: structuredClone(INITIAL_EMOTION_STATE) as EmotionState,
    emotionEvent: null,
    userAnalysis: {
      expressedEmotion: c.emotion,
      intensity: c.intensity,
      directedAtAI: c.atAI ?? false,
      likelyCause: 'test',
    },
    recentUserMoods: [],
    roundNumber: 1,
    lastInteractionAt: Date.now(),
  } as never);

  const state = out.updatedEmotionState;
  const es = structuredClone(state) as EmotionState;
  es.taiji.arousal = 0.7; // 保证跨过形成门限，测的是"记成什么"而不是"记不记得"

  // 旧读法：绝对值 argmax（v1.20 之前 episodicMemory 用的就是这个）
  const oldLabel = getDominantEmotion(es.emotions).name;

  const store = createEpisodicMemoryStore();
  store.prevValence = es.taiji.valence - 0.3; // 制造一次明显波动，确保形成记忆
  const ep = tryFormEpisode(store, es, c.text, '');

  rows.push({
    text: c.text,
    oldLabel,
    newLabel: ep?.emotionalImpact.dominantEmotion ?? '（未形成记忆）',
    narrative: ep?.narrativeFragment ?? '',
    tags: (ep?.tags ?? []).join(','),
    activation: separateActivation(es.emotions).note,
  });
}

console.log('同一句话，两种读法给她记下的东西\n');
for (const r of rows) {
  console.log(`他说：「${r.text}」`);
  console.log(`  她的状态读数    ${r.activation}`);
  console.log(`  旧（基线 argmax）${r.oldLabel}`);
  console.log(`  新（激活态）    ${r.newLabel}      标签: ${r.tags}`);
  console.log(`  她记下的叙事    ${r.narrative}`);
  console.log('');
}

const calmOld = rows.filter(r => r.oldLabel === 'calm').length;
const calmNew = rows.filter(r => r.newLabel === 'calm').length;
const restingNew = rows.filter(r => r.newLabel === 'resting').length;
console.log('── 判读 ──');
console.log(`旧读法把 ${calmOld}/${rows.length} 条记成 calm；新读法 ${calmNew} 条 calm、${restingNew} 条 resting（静息就明说静息）。`);
console.log('resting ≠ calm：calm 是"她确实平静"，resting 是"她没有被激起"，');
console.log('所以 resting 的叙事不许顺口说成"满足""幸福"——那是凭空给她加感受。');
console.log('另外 `dominantEmotion = resting` 不是情绪键 ⇒ "情感一致性 ×1.5"永远不成立（正确：');
console.log('没有情绪的记忆不该因为情绪被优先召回），图谱也不会拿它去和真·calm 节点连假情感边。');
