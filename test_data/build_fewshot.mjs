#!/usr/bin/env node
/**
 * 从 LLM Judge 结果中提取每类情绪 Top-3 高分回复，生成 few-shot 示例注入 Prompt
 * Usage: node test_data/build_fewshot.mjs [--top N] [--min-score 0.85]
 */
import { readFileSync, writeFileSync } from 'fs';

const TOP = process.argv.includes('--top') ? parseInt(process.argv[process.argv.indexOf('--top') + 1]) : 3;
const MIN_SCORE = process.argv.includes('--min-score') ? parseFloat(process.argv[process.argv.indexOf('--min-score') + 1]) : 0;

const data = JSON.parse(readFileSync('test_data/eval_llm_judge.json', 'utf-8'));

// Group by category, filter by min score, sort by llmScore desc, pick top N
const byCategory = {};
for (const r of data.results) {
  if (r.llmScore === null || r.llmScore < MIN_SCORE) continue;
  if (!byCategory[r.category]) byCategory[r.category] = [];
  byCategory[r.category].push(r);
}

// Sort and pick top N
const topExamples = {};
for (const [cat, items] of Object.entries(byCategory)) {
  items.sort((a, b) => b.llmScore - a.llmScore);
  topExamples[cat] = items.slice(0, TOP);
}

// Build few-shot prompt snippet
function buildFewShotSection(examplesByCat) {
  const sections = [];
  for (const [cat, examples] of Object.entries(examplesByCat)) {
    if (examples.length === 0) continue;
    const items = examples.map((e, i) => {
      return `例${i + 1}：用户"${e.input}" → "${e.output}"（评分 ${e.llmScore.toFixed(2)}）`;
    }).join('\n');
    sections.push(`### ${cat} 高分示例\n${items}`);
  }
  return sections.join('\n\n');
}

// Build per-category few-shot injectable into individual emotion sections
function buildInlineExamples(examplesByCat) {
  const result = {};
  for (const [cat, examples] of Object.entries(examplesByCat)) {
    if (examples.length === 0) continue;
    const lines = [];
    for (const e of examples) {
      lines.push(`- 示例：用户说"${e.input}" → ✅ "${e.output}" (得分 ${e.llmScore.toFixed(2)})`);
    }
    result[cat] = lines.join('\n');
  }
  return result;
}

const fewShotBlock = buildFewShotSection(topExamples);
const inlineExamples = buildInlineExamples(topExamples);

const output = {
  meta: {
    topN: TOP,
    minScore: MIN_SCORE,
    source: 'eval_llm_judge.json',
    timestamp: new Date().toISOString(),
  },
  // For direct prompt injection: one big block at end of neutral prompt
  fewShotBlock: `## 各类情绪高分回复示例（请模仿以下回复的风格和自然度）\n\n${fewShotBlock}`,
  // Per-category inline examples for targeted injection
  inlineExamples,
  raw: topExamples,
};

writeFileSync('test_data/fewshot_examples.json', JSON.stringify(output, null, 2));

// Stats
console.log('📊 Few-shot 示例提取完成');
console.log(`Top-${TOP} per category, min score >= ${MIN_SCORE}`);
console.log();
for (const [cat, exs] of Object.entries(topExamples).sort((a, b) => {
  const avgA = a[1].reduce((s, e) => s + e.llmScore, 0) / a[1].length;
  const avgB = b[1].reduce((s, e) => s + e.llmScore, 0) / b[1].length;
  return avgA - avgB;
})) {
  const avg = (exs.reduce((s, e) => s + e.llmScore, 0) / exs.length).toFixed(2);
  console.log(`  ${cat.padEnd(4)} avg=${avg}  | ${exs.map(e => e.llmScore.toFixed(2)).join(', ')}`);
}
console.log(`\n📂 输出: test_data/fewshot_examples.json`);
console.log(`📏 Few-shot block: ${fewShotBlock.length} 字符`);
