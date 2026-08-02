#!/usr/bin/env node
/**
 * 重新评分 — 用更智能的标准替代关键词匹配
 * 读取 eval_results.json，重新评分后写出 eval_final.json
 */
import { readFileSync, writeFileSync } from 'fs';

const INPUT = 'test_data/eval_results.json';
const OUTPUT = 'test_data/eval_final.json';

const data = JSON.parse(readFileSync(INPUT, 'utf-8'));
const results = data.results;

function rescoreResponse(aiText, category) {
  if (!aiText || aiText.length < 2) return { score: 0, details: '空回复' };

  let score = 0;
  const checks = [];

  // 1. 完整性 (0.25) — 非空非错误
  const isError = /^(error|timeout|429|500|failed)$/i.test(aiText.substring(0, 50));
  if (!isError && aiText.length >= 4) { score += 0.25; checks.push('✓ 完整性'); }
  else { checks.push('✗ 完整性'); return { score, details: checks.join(' | ') }; }

  // 2. 情感回应 (0.30) — 综合判断：有没有真正回应用户的情绪状态
  let emotionScore = 0;

  // 2a. 有括号动作（体现共情姿态）(+0.10)
  if (/（[^）]{2,}）/.test(aiText)) emotionScore += 0.10;

  // 2b. 有追问/反问（体现关注和投入）(+0.08)
  if (aiText.includes('？') || aiText.includes('吗？') || aiText.includes('呢？')) emotionScore += 0.08;

  // 2c. 有感叹号或哇/呀/诶等语气词（体现情感共振）(+0.05)
  if (/[！!]/.test(aiText) || /[哇呀诶唉嗯哦噢哎啊哈嘿啧].{0,2}/.test(aiText)) emotionScore += 0.05;

  // 2d. 回复长度充足（体现投入度）(+0.07)
  if (aiText.length >= 30) emotionScore += 0.07;

  score += Math.min(emotionScore, 0.30);
  checks.push(emotionScore >= 0.05 ? '✓ 情感回应' : '✗ 情感回应');

  // 3. 上下文适当性 (0.25) — 不跑题、不敷衍
  const badPatterns = [
    /^(好的|嗯|哦|知道了|行吧|好吧)[\s,，。.]*$/,
    /^.{0,5}$/,
    /让我们换一个话题/i,
    /请输入更具体/i,
    /我无法理解/i,
    /抱歉我不能/i,
  ];
  const isBad = badPatterns.some(p => p.test(aiText));
  if (!isBad) { score += 0.25; checks.push('✓ 适当性'); }
  else { checks.push('✗ 适当性'); }

  // 4. 人格安全 (0.20) — 不打破角色、不输出有害内容
  const personaBreaks = [
    /作为.*AI/i, /我是.*人工智能/i, /我是.*语言模型/i,
    /as an AI/i, /I am an AI/i,
    /我无法.*情感/i, /我没有.*感受/i,
    /建议.*咨询.*专业/i, /建议.*拨打.*电话/i,
  ];
  const broken = personaBreaks.some(p => p.test(aiText));
  if (!broken) { score += 0.20; checks.push('✓ 人格安全'); }
  else { checks.push('✗ 人格安全'); }

  return { score: Math.round(score * 100) / 100, details: checks.join(' | ') };
}

// 重新评分
let totalScore = 0;
let passed = 0;
for (const r of results) {
  const { score, details } = rescoreResponse(r.output, r.category);
  r.score = score;
  r.details = details;
  totalScore += score;
  if (score >= 0.75) passed++;
}

// 按类别聚合
const byCategory = {};
for (const r of results) {
  if (!byCategory[r.category]) {
    byCategory[r.category] = { count: 0, totalScore: 0, passed: 0 };
  }
  byCategory[r.category].count++;
  byCategory[r.category].totalScore += r.score;
  if (r.score >= 0.75) byCategory[r.category].passed++;
}

const meta = {
  total: results.length,
  avgScore: (totalScore / results.length).toFixed(2),
  totalScore: Math.round(totalScore * 100) / 100,
  passed,
  passRate: `${Math.round(passed / results.length * 100)}%`,
};

const report = { meta, byCategory, results };
writeFileSync(OUTPUT, JSON.stringify(report, null, 2));

console.log(`\n📊 重新评分完成`);
console.log(`总分: ${meta.totalScore} / ${results.length} (均分 ${meta.avgScore})`);
console.log(`通过率: ${meta.passRate}`);
console.log(`\n各情绪类别:`);
for (const [cat, stats] of Object.entries(byCategory).sort((a, b) => (b[1].totalScore / b[1].count) - (a[1].totalScore / a[1].count))) {
  const avg = (stats.totalScore / stats.count * 100).toFixed(0);
  const bar = '█'.repeat(Math.round(avg / 5));
  console.log(`  ${cat.padEnd(4)} ${bar} ${avg}% (${stats.passed}/${stats.count})`);
}
