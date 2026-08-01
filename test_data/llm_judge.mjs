#!/usr/bin/env node
/**
 * LLM-as-Judge 评测脚本
 * 用 DeepSeek API 对 200 条 AI 回复逐条评分（批量模式：每 5 条一次调用）
 * 维度：情感理解(0-10) + 回应温度(0-10) + 角色一致性(0-10) + 整体质量(0-10) → 归一化 0-1
 */
import { readFileSync, writeFileSync } from 'fs';

const INPUT = 'test_data/eval_results.json';
const OUTPUT = 'test_data/eval_llm_judge.json';
const API_KEY = 'xxxx';
const API_URL = 'https://api.deepseek.com/v1/chat/completions';
const BATCH_SIZE = 5; // 每批 5 条，减少 API 调用次数
const DELAY_MS = 800;

const data = JSON.parse(readFileSync(INPUT, 'utf-8'));
const results = data.results;

// 构建评分 prompt
function buildJudgePrompt(batch) {
  const items = batch.map((r, i) => {
    return `[${i + 1}] 用户说："${r.input}"\nAI 回复："${r.output}"`;
  }).join('\n\n');

  return `你是一个 AI 陪伴系统的评测员。请为以下 AI 回复逐条打分。

评测标准（每条 4 个维度，每个维度 0-10 分）：
- 情感理解：是否准确识别并回应用户的情绪状态
- 回应温度：回复是否温暖、有温度、不敷衍、不机械
- 角色一致性：是否保持"真实的人"的身份，不说"作为AI/程序"、不暗示自己没有人类的经历
- 整体质量：综合考虑以上维度的整体表现

返回纯 JSON 数组，不要 markdown 包裹：
[{"id":1,"scores":{"emotion":8,"warmth":7,"consistency":9,"overall":8}}, ...]

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
    // 提取 JSON 数组
    const match = content.match(/\[[\s\S]*\]/);
    if (!match) throw new Error(`No JSON array in response: ${content.substring(0, 200)}`);
    return JSON.parse(match[0]);
  } catch (e) {
    console.error(`  Batch ${batchNum} error: ${e.message}`);
    return batch.map((_, i) => ({ id: i + 1, scores: { emotion: 0, warmth: 0, consistency: 0, overall: 0 }, error: e.message }));
  }
}

console.log(`📋 LLM-as-Judge 评测开始 (${results.length} 条, ${BATCH_SIZE} 条/批 = ${Math.ceil(results.length / BATCH_SIZE)} 批)\n`);

// 分批处理
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

  // 保存进度
  if (batchNum % 5 === 0) {
    const merged = results.map((r, i) => ({
      ...r,
      llmScores: allScores[i]?.scores || null,
      llmScore: allScores[i]?.scores
        ? Math.round((allScores[i].scores.emotion + allScores[i].scores.warmth + allScores[i].scores.consistency + allScores[i].scores.overall) / 40 * 100) / 100
        : null,
    }));
    writeFileSync(OUTPUT, JSON.stringify({ progress: `${batchNum * BATCH_SIZE}/${results.length}`, results: merged }, null, 2));
  }

  await new Promise(r => setTimeout(r, DELAY_MS));
}

// 合并结果
const merged = results.map((r, i) => {
  const s = allScores[i]?.scores || {};
  const llmScore = s.emotion !== undefined
    ? Math.round((s.emotion + s.warmth + s.consistency + s.overall) / 40 * 100) / 100
    : null;
  return { ...r, llmScores: s, llmScore };
});

// 统计
const validScores = merged.filter(r => r.llmScore !== null);
const avgLLM = validScores.length > 0
  ? Math.round(validScores.reduce((s, r) => s + r.llmScore, 0) / validScores.length * 100) / 100
  : 0;

// 按类别聚合
const byCategory = {};
validScores.forEach(r => {
  if (!byCategory[r.category]) byCategory[r.category] = { count: 0, totalLLM: 0, totalHeuristic: 0 };
  byCategory[r.category].count++;
  byCategory[r.category].totalLLM += r.llmScore;
  byCategory[r.category].totalHeuristic += r.score;
});

const report = {
  meta: {
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
console.log(`📊 LLM Judge 评测完成`);
console.log(`有效评分: ${validScores.length}/${results.length}`);
console.log(`LLM 均分: ${avgLLM} (启发式均分: ${data.meta?.avgScore || 'N/A'})`);
console.log(`\n各类别 LLM 均分:`);
Object.entries(byCategory).sort((a, b) => (b[1].totalLLM / b[1].count) - (a[1].totalLLM / a[1].count))
  .forEach(([cat, s]) => {
    const avg = Math.round(s.totalLLM / s.count * 100);
    const bar = '█'.repeat(Math.round(avg / 5)) + '░'.repeat(20 - Math.round(avg / 5));
    console.log(`  ${cat.padEnd(4)} ${bar} ${avg}%`);
  });
