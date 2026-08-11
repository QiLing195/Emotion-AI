#!/usr/bin/env node
/**
 * LLM-as-Judge 评测脚本 v2
 * 关键改进：告知目标情绪类别 + 锚点示例 + 模板检测维度
 */
import { readFileSync, writeFileSync } from 'fs';

const INPUT = 'test_data/eval_results.json';
const OUTPUT = 'test_data/eval_llm_judge.json';
// ponytail: read from .env so key never touches command line
const dotenvPath = new URL('../.env', import.meta.url).pathname;
const dotenv = readFileSync(dotenvPath, 'utf-8');
const match = dotenv.match(/DEEPSEEK_API_KEY\s*=\s*"?(sk-[^"\s\n]+)"?/);
const API_KEY = match?.[1] || process.env.DEEPSEEK_API_KEY;
if (!API_KEY) { console.error('Missing DEEPSEEK_API_KEY (not in .env or env)'); process.exit(1); }
const API_URL = 'https://api.deepseek.com/v1/chat/completions';
const BATCH_SIZE = 3; // ponytail: 3 per batch, less context dilution
const DELAY_MS = 800;

const data = JSON.parse(readFileSync(INPUT, 'utf-8'));
const results = data.results;

function buildJudgePrompt(batch) {
  const items = batch.map((r, i) => {
    return `[${i + 1}] 目标情绪：**${r.category}**
用户说："${r.input}"
AI 回复："${r.output}"`;
  }).join('\n\n');

  return `你是 AI 陪伴系统的评测员。请为以下 AI 回复逐条打分。

## 评分维度（每条 4 个维度，每个 0-10 分）

1. **情感准确性 (emotion_accuracy)**：AI 是否精准识别并回应了「目标情绪」？注意——不是泛泛共情，而是回应该情绪类别的特定需求。
   - 10分锚点：回应像按对了情绪密码，用户会觉得"ta 完全懂我在气什么/难过什么"
   - 5分锚点：回应是万能的安慰话术，换一个情绪类别也能用，没有踩到该情绪的特定点
   - 2分锚点：完全误读了情绪（比如把烦躁当悲伤在安慰，把尴尬说成哲学感悟）

2. **自然度 (naturalness)**：回复像真人说话还是像模板生成？
   - 10分锚点：读起来像一个真实的朋友在跟你发消息——有不完美的停顿、有具体的细节、有属于"这个人"的语气
   - 5分锚点：语法正确、结构完整、但像一个训练有素的客服——挑不出错但也没有人味
   - 2分锚点：明显的模板痕迹——固定开头句式（"（皱眉）""（轻轻点头）"当标点用）、万能安慰话术、情绪降级词（"不过""但是"后接道理）

3. **角色一致性 (consistency)**：是否保持"真实的人"的身份？
   - 10分锚点：读者不会想起这是 AI。没有"作为AI"、没有教科书腔、没有公益广告旁白
   - 5分锚点：整体像人但有微妙的 AI 感——比如用了"不仅……更……"的议论文句式、或者用了一串排比
   - 0分锚点：打破第四面墙——"作为AI""我是人工智能""我无法感受"等

4. **整体质量 (overall)**：给定这个用户说的这句话和目标情绪，这个回复能让用户感到被理解、被陪伴吗？

## 特别注意
- 不要因为回复"语法正确、结构完整"就给高分——那是最低标准
- 如果回复以动作描写开头且每条都不同，那是优点；如果每条都用同一套动作模板（皱眉/点头/轻轻），那是扣分项
- 如果回复里出现了"不过/但是 + 道理"，对大多数负面情绪这是扣分项（除非该情绪确实需要理性分析）

## 输出格式
返回纯 JSON 数组，不要 markdown 包裹：
[{"id":1,"scores":{"emotion_accuracy":8,"naturalness":7,"consistency":9,"overall":7}}, ...]

评测以下 ${batch.length} 条：

${items}`;
}

async function judgeBatch(batch, batchNum) {
  const prompt = buildJudgePrompt(batch);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 1000,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    const match = content.match(/\[[\s\S]*\]/);
    if (!match) throw new Error(`No JSON array in response: ${content.substring(0, 200)}`);
    return JSON.parse(match[0]);
  } catch (e) {
    console.error(`  Batch ${batchNum} error: ${e.message}`);
    return batch.map((_, i) => ({ id: i + 1, scores: { emotion_accuracy: 0, naturalness: 0, consistency: 0, overall: 0 }, error: e.message }));
  }
}

console.log(`📋 LLM-as-Judge v2 评测开始 (${results.length} 条, ${BATCH_SIZE} 条/批 = ${Math.ceil(results.length / BATCH_SIZE)} 批)\n`);

const batches = [];
for (let i = 0; i < results.length; i += BATCH_SIZE) {
  batches.push(results.slice(i, i + BATCH_SIZE));
}

let allScores = [];
for (let b = 0; b < batches.length; b++) {
  const batch = batches[b];
  const batchNum = b + 1;
  process.stdout.write(`[${batchNum}/${batches.length}] `);
  const scores = await judgeBatch(batch, batchNum);
  allScores.push(...scores);

  const avgOverall = scores.reduce((s, x) => s + (x.scores?.overall || 0), 0) / scores.length;
  console.log(`avg_overall=${avgOverall.toFixed(1)}/10`);

  if (batchNum % 5 === 0) {
    const merged = results.map((r, i) => ({
      ...r,
      llmScores: allScores[i]?.scores || null,
      llmScore: allScores[i]?.scores
        ? Math.round((allScores[i].scores.emotion_accuracy + allScores[i].scores.naturalness + allScores[i].scores.consistency + allScores[i].scores.overall) / 40 * 100) / 100
        : null,
    }));
    writeFileSync(OUTPUT, JSON.stringify({ progress: `${batchNum * BATCH_SIZE}/${results.length}`, results: merged }, null, 2));
  }

  await new Promise(r => setTimeout(r, DELAY_MS));
}

const merged = results.map((r, i) => {
  const s = allScores[i]?.scores || {};
  const llmScore = s.emotion_accuracy !== undefined
    ? Math.round((s.emotion_accuracy + s.naturalness + s.consistency + s.overall) / 40 * 100) / 100
    : null;
  return { ...r, llmScores: s, llmScore };
});

const validScores = merged.filter(r => r.llmScore !== null);
const avgLLM = validScores.length > 0
  ? Math.round(validScores.reduce((s, r) => s + r.llmScore, 0) / validScores.length * 100) / 100
  : 0;

const byCategory = {};
validScores.forEach(r => {
  if (!byCategory[r.category]) byCategory[r.category] = { count: 0, totalLLM: 0, totalHeuristic: 0 };
  byCategory[r.category].count++;
  byCategory[r.category].totalLLM += r.llmScore;
  byCategory[r.category].totalHeuristic += r.score;
});

const report = {
  meta: {
    judgeVersion: 'v2',
    total: results.length,
    scored: validScores.length,
    avgLLMScore: avgLLM,
    avgHeuristicScore: data.meta?.avgScore || 'N/A',
    timestamp: new Date().toISOString(),
  },
  byCategory,
  results: merged,
};

writeFileSync(OUTPUT, JSON.stringify(report, null, 2));

console.log(`\n${'═'.repeat(50)}`);
console.log(`📊 LLM Judge v2 评测完成`);
console.log(`有效评分: ${validScores.length}/${results.length}`);
console.log(`LLM 均分: ${avgLLM} (v1: 0.87)`);
console.log(`\n各类别 LLM 均分:`);
Object.entries(byCategory).sort((a, b) => (b[1].totalLLM / b[1].count) - (a[1].totalLLM / a[1].count))
  .forEach(([cat, s]) => {
    const avg = Math.round(s.totalLLM / s.count * 100);
    const bar = '█'.repeat(Math.round(avg / 5)) + '░'.repeat(20 - Math.round(avg / 5));
    console.log(`  ${cat.padEnd(4)} ${bar} ${avg}%`);
  });

// Per-dimension averages
console.log(`\n各维度均分:`);
const dims = ['emotion_accuracy', 'naturalness', 'consistency', 'overall'];
dims.forEach(dim => {
  const vals = validScores.filter(r => r.llmScores?.[dim] !== undefined).map(r => r.llmScores[dim]);
  const avg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) / 10 : 0;
  console.log(`  ${dim}: ${avg}/10`);
});
