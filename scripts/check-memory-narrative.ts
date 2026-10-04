// 记忆叙事实测（v1.21）—— 接线后，她"记得的事"是不是真的换成了她自己的话？
//
// 两段：
//   ① 离线：校验器的接受/拒绝表（不需要 API），确认它拦得住那几类真实故障
//   ② 在线：走**真实管道**（processTurn → tryFormEpisode）+ **真实 LLM**，
//      打印"模板叙事 → 模型产出 → 校验判定 → 最终入库"的完整链路
//
// 用法: node node_modules/tsx/dist/cli.mjs scripts/check-memory-narrative.ts
//   （在线部分会真的调 LLM，约 5 次；设置 DISABLE_MEMORY_NARRATIVE_LLM 不影响本脚本）
import { readFileSync } from 'node:fs';
import { aiCoordinator } from '../server/services/aiCoordinator.js';
import { INITIAL_EMOTION_STATE, setDeterministicMode } from '../src/lib/emotionEngine.js';
import { separateActivation } from '../src/lib/emotionActivation.js';
import {
  createEpisodicMemoryStore, tryFormEpisode, buildNarrativePrompt,
  parseNarrativeReply, isUsableNarrative, updateEpisodeNarrative,
  narrativeRejectReason, normalizeNarrativeReply,
} from '../src/lib/episodicMemory.js';
import { generateAIResponse } from '../src/lib/aiProvider.js';
import { MemoryGraph, createNodeFromEpisode, syncEpisodicNode } from '../src/lib/memoryGraph.js';
import type { EmotionState } from '../src/lib/emotionTypes.js';

setDeterministicMode(true);

// ── ① 校验器：接受 / 拒绝（纯离线）────────────────────────────────────────────
const HIS = '我下周要去做一个体检，有点担心结果';
const OFFLINE: Array<[string, boolean, string]> = [
  ['说不出的忐忑，我怕他一个人扛着', true, '正常的一句话'],
  ['作为一个AI，我的情绪参数显示担忧', false, '元描述/系统口吻'],
  ['你上次说体检前紧张得没睡好，我也跟着难受', false, '替他断言事实（编造）'],
  ['当他说"我下周要去复检"的时候，心揪了一下', false, '引文与他原话不符（复检 ≠ 体检）'],
  ['当他说"体检"的时候，我心里揪了一下', true, '引文逐字出自他的原话'],
  ['内心是平静的，像湖面没有一丝波澜', false, '整句照抄模板（等于没换）'],
  ['嗯', false, '太短'],
  ['a'.repeat(80), false, '超长'],
  ['他心里悬着的事，我也悬着', true, '不含引文、正常一句话'],
  // ⚠️ 这两条是**误杀回归**：第一版规则把时间词写成可选（`你…说`），
  // 于是「听你说难过」这种**当下**的转述被当成"替他断言过去"，实测真实模型产出被误杀 2/5。
  ['听你说难过，我只想紧紧抱住你，让你知道有人在乎你', true, '当下的转述，不是断言过去（曾误杀）'],
  ['你上次说体检前紧张得没睡好，我也跟着难受', false, '有"上次"→ 确实是替他断言过去'],
  ['她说话的语气很轻，我听得出那点不安', false, '人称错位：把对方写成"她"（实测模型真会这样）'],
];

console.log('── ① 校验器（离线，不需要 API）──');
let pass = 0;
for (const [text, expect, why] of OFFLINE) {
  const got = isUsableNarrative(text, HIS);
  const ok = got === expect;
  if (ok) pass++;
  console.log(`  ${ok ? '✓' : '✗'} 期望${expect ? '接受' : '拒绝'} / 实际${got ? '接受' : '拒绝'}  ${why}`);
  if (!ok) console.log(`      「${text}」`);
}
console.log(`  ${pass}/${OFFLINE.length} 条符合预期\n`);

// ── ② 真实管道 + 真实 LLM ─────────────────────────────────────────────────
let settings: any = null;
try {
  const dotenv = readFileSync('.env', 'utf-8');
  const g = dotenv.match(/^GEMINI_API_KEY="?(.+?)"?$/m)?.[1];
  const o = dotenv.match(/^OPENAI_API_KEY="?(.+?)"?$/m)?.[1];
  const d = dotenv.match(/^DEEPSEEK_API_KEY="?(.+?)"?$/m)?.[1];
  if (g && g !== 'your_gemini_api_key_here') settings = { provider: 'gemini', apiKey: g, model: 'gemini-3-flash-preview' };
  else if (o && o !== 'your_openai_api_key_here') settings = { provider: 'openai', apiKey: o, model: 'gpt-4-turbo' };
  else if (d && d !== 'your_deepseek_api_key_here') settings = { provider: 'deepseek', apiKey: d, model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1' };
} catch { /* .env 不存在 */ }

const CASES: Array<{ text: string; emotion: string; intensity: number; atAI?: boolean }> = [
  { text: '我下周要去做一个体检，有点担心结果', emotion: 'fear', intensity: 0.7 },
  { text: '我今天特别难过，什么都做不好', emotion: 'sad', intensity: 0.9 },
  { text: '下个月是我生日，想请你陪我一起过，你会来吗？', emotion: 'joy', intensity: 0.8, atAI: true },
  { text: '我其实一直很害怕失去你，从小就缺乏安全感，从来不敢跟任何人说这些', emotion: 'fear', intensity: 0.8, atAI: true },
  { text: '今天路上看到一只小猫，挺可爱的', emotion: 'joy', intensity: 0.4 },
];

if (!settings) {
  console.log('（没有可用 API key，跳过在线部分）');
  process.exit(0);
}
console.log(`── ② 真实管道 + 真实 LLM（provider=${settings.provider} model=${settings.model}）──\n`);

const graph = new MemoryGraph();
let llmCount = 0;
let accepted = 0;

for (const c of CASES) {
  const out = aiCoordinator.processTurn({
    userText: c.text,
    currentEmotionState: structuredClone(INITIAL_EMOTION_STATE) as EmotionState,
    emotionEvent: null,
    userAnalysis: { expressedEmotion: c.emotion, intensity: c.intensity, directedAtAI: c.atAI ?? false, likelyCause: 'test' },
    recentUserMoods: [], roundNumber: 1, lastInteractionAt: Date.now(),
  } as never);

  const es = structuredClone(out.updatedEmotionState) as EmotionState;
  es.taiji.arousal = 0.7;                       // 保证跨过形成门限（测的是"记成什么"）
  const store = createEpisodicMemoryStore();
  store.prevValence = es.taiji.valence - 0.3;   // 制造一次明显波动
  const ep = tryFormEpisode(store, es, c.text, '');
  if (!ep) { console.log(`（未形成记忆）${c.text}\n`); continue; }

  graph.addNode(createNodeFromEpisode(ep));
  const a = separateActivation(es.emotions);
  console.log(`他说：「${c.text}」`);
  console.log(`  她的状态：${a.note}`);
  console.log(`  记下的情绪：${ep.emotionalImpact.dominantEmotion}   标签 [${ep.tags.join(',')}]`);
  console.log(`  模板叙事：${ep.narrativeFragment}`);

  llmCount++;
  let raw = '';
  try {
    raw = await generateAIResponse(
      settings,
      '你是角色内心独白的撰写者。只输出一句话，不要解释、不要引号。',
      buildNarrativePrompt(ep),
      false,
      0.9,
    );
  } catch (e) {
    console.log(`  ⚠️ LLM 调用失败：${(e as Error).message}\n`);
    continue;
  }
  const text = parseNarrativeReply(raw, ep.eventSummary);
  console.log(`  模型原始：${raw.trim().replace(/\s+/g, ' ').slice(0, 70)}`);
  if (!text) {
    const reason = narrativeRejectReason(normalizeNarrativeReply(raw), ep.eventSummary);
    console.log(`  → 未过校验（${reason}），**保留模板**\n`);
    continue;
  }
  accepted++;
  updateEpisodeNarrative(store, ep.id, text);
  const synced = syncEpisodicNode(graph, ep);
  const node = graph.getAllNodes().find(n => n.sourceId === ep.id);
  console.log(`  → 采纳：${ep.narrativeFragment}   (narrativeSource=${ep.narrativeSource})`);
  console.log(`  → 图谱同步：${synced && node?.content === ep.narrativeFragment ? '✓ 两处一致' : '✗ 不一致'}\n`);
}

console.log(`── 汇总 ──`);
console.log(`真实调用 ${llmCount} 次，过校验采纳 ${accepted} 次（未过的保留模板）。`);
console.log('模板是"当他说X的时候，<9×3 个固定句之一>"；上面采纳的每一条都是按她那刻的状态写的。');
