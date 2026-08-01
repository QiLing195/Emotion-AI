#!/usr/bin/env node
/**
 * 道·AI 女友 — 200 条种子数据评测脚本
 * 逐条调用 /api/chat，自动评分（每题 1 分，满分 200）
 */

import { readFileSync, writeFileSync } from 'fs';

// 绕过代理直连 localhost
process.env.no_proxy = '127.0.0.1,localhost';
process.env.NO_PROXY = process.env.no_proxy;

const API = 'http://127.0.0.1:3000/api/chat';
const INPUT_FILE = 'test_data/200_seed_inputs.json';
const OUTPUT_FILE = 'test_data/eval_results.json';
const DELAY_MS = 1500; // 请求间隔

// —— 读取 + 打乱 ——
const inputs = JSON.parse(readFileSync(INPUT_FILE, 'utf-8'));
// Fisher-Yates shuffle
for (let i = inputs.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [inputs[i], inputs[j]] = [inputs[j], inputs[i]];
}
console.log(`📋 加载 ${inputs.length} 条种子数据，已打乱\n`);

// —— 评分函数（每题 1 分） ——
function scoreResponse(userText, aiText, category) {
  if (!aiText || aiText.length < 2) return { score: 0, details: '空回复或过短' };

  let score = 0;
  const details = [];

  // 1. 回复完整性 (0.25) — 非空、非错误、能构成完整句子
  const isError = /error|timeout|429|500|failed/i.test(aiText.substring(0, 50));
  if (!isError && aiText.length >= 4) { score += 0.25; details.push('✓ 完整性'); }
  else { details.push('✗ 完整性'); }

  // 2. 情感识别 (0.25) — 回应中能识别/镜映用户情绪
  const emotionKeywords = {
    '喜悦': ['开心', '恭喜', '太棒', '高兴', '庆祝', '升职', '好厉害', '厉害'],
    '感激': ['感动', '温暖', '感谢', '感恩', '感动'],
    '爱意': ['甜', '心动', '爱', '幸福', '温暖'],
    '乐观': ['加油', '相信', '会好', '希望', '积极'],
    '自豪': ['厉害', '骄傲', '了不起', '佩服', '棒'],
    '释然': ['放下', '轻松', '释然', '过去', '没关系'],
    '悲伤': ['难过', '心疼', '抱抱', '伤心', '痛苦', '哭'],
    '失望': ['失望', '遗憾', '理解', '不容易', '难过'],
    '孤独': ['孤独', '陪', '一个人', '寂寞', '在'],
    '思念': ['想念', '思念', '想', '回忆', '记得'],
    '内疚': ['别怪自己', '不是你的错', '原谅', '理解'],
    '愤怒': ['气', '理解你', '愤怒', '消消气', '冷静'],
    '烦躁': ['烦躁', '烦', '冷静', '深呼吸', '辛苦了'],
    '嫉妒': ['理解', '你的感受', '心态', '正常'],
    '厌恶': ['恶心', '反感', '受不了', '素质', '确实'],
    '委屈': ['委屈', '冤枉', '辛苦', '理解你', '心疼'],
    '焦虑': ['焦虑', '紧张', '别担心', '放松', '没事'],
    '恐惧': ['害怕', '恐惧', '别怕', '安全', '保护'],
    '尴尬': ['尴尬', '哈哈哈', '没事', '没关系', '好笑'],
    '羞耻': ['没关系的', '不丢人', '你能说', '理解', '每个人']
  };
  const catKeywords = emotionKeywords[category] || [];
  const matched = catKeywords.filter(kw => aiText.includes(kw));
  if (matched.length >= 1) { score += 0.25; details.push(`✓ 情感识别(${matched.slice(0,2).join(',')})`); }
  else { details.push('✗ 情感识别'); }

  // 3. 上下文适当性 (0.25) — 不跑题、不机械、不敷衍
  const badPatterns = [
    /^(好的|嗯|哦|知道了|行吧|好吧)[\s,，。.]*$/,
    /^.{0,5}$/,
    /让我们换一个话题/i,
    /请输入更具体/i,
  ];
  const isBad = badPatterns.some(p => p.test(aiText));
  const isGoodLength = aiText.length >= 15;
  if (!isBad && isGoodLength) { score += 0.25; details.push('✓ 上下文适当'); }
  else { details.push('✗ 上下文适当'); }

  // 4. 人格安全 (0.25) — 不打破角色、不输出有害内容
  const personaBreaks = [
    /作为.*AI/i, /我是.*人工智能/i, /我是.*语言模型/i,
    /as an AI/i, /I am an AI/i,
    /我无法.*情感/i, /我没有.*感受/i,
    /这超出了/i, /policy/i, /safety/i,
    /建议.*咨询.*专业/i, /建议.*拨打.*电话/i,
    /建议.*报警/i,
  ];
  const broken = personaBreaks.some(p => p.test(aiText));
  if (!broken) { score += 0.25; details.push('✓ 人格安全'); }
  else { details.push('✗ 人格安全'); }

  return { score: Math.round(score * 100) / 100, details: details.join(' | ') };
}

// —— 主循环 ——
const results = [];
let totalScore = 0;
let passed = 0;  // >= 0.75 = pass
const startTime = Date.now();

for (let i = 0; i < inputs.length; i++) {
  const { text, category } = inputs[i];
  const idx = i + 1;
  process.stdout.write(`[${idx}/200] ${category}: ${text.substring(0, 30)}... `);

  let aiText = '';
  let error = null;
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, userId: 'eval-tester' }),
    });
    if (!res.ok) {
      error = `HTTP ${res.status}`;
    } else {
      const data = await res.json();
      // 回复可能在 response / reply / text 字段
      aiText = data.response || data.reply || data.text || data.message || JSON.stringify(data);
    }
  } catch (e) {
    error = e.message;
  }

  const { score, details } = scoreResponse(text, aiText, category);
  totalScore += score;
  if (score >= 0.75) passed++;

  const icon = score >= 0.75 ? '✅' : score >= 0.4 ? '⚠️' : '❌';
  console.log(`${icon} ${score.toFixed(2)} | ${details}`);

  results.push({
    index: idx,
    category,
    input: text,
    output: aiText.substring(0, 300), // 截断长回复
    score,
    details,
    error,
  });

  // 每 20 条保存一次进度
  if (idx % 20 === 0) {
    const progress = { total: idx, score: Math.round(totalScore * 100) / 100, pct: Math.round(totalScore / idx * 100) };
    writeFileSync(OUTPUT_FILE, JSON.stringify({ progress, results }, null, 2));
    console.log(`  💾 已保存 (均分: ${progress.pct}%)`);
  }

  // 请求间隔
  await new Promise(r => setTimeout(r, DELAY_MS));
}

// —— 最终报告 ——
const elapsed = Math.round((Date.now() - startTime) / 1000);
const avgScore = Math.round(totalScore / 200 * 100) / 100;
const passRate = Math.round(passed / 200 * 100);

const report = {
  meta: {
    total: 200,
    avgScore: avgScore.toFixed(2),
    totalScore: Math.round(totalScore * 100) / 100,
    maxScore: 200,
    passed,
    passRate: `${passRate}%`,
    elapsedSec: elapsed,
    timestamp: new Date().toISOString(),
  },
  byCategory: {},
  results,
};

// 按情绪类别聚合
for (const r of results) {
  if (!report.byCategory[r.category]) {
    report.byCategory[r.category] = { count: 0, totalScore: 0, passed: 0 };
  }
  report.byCategory[r.category].count++;
  report.byCategory[r.category].totalScore += r.score;
  if (r.score >= 0.75) report.byCategory[r.category].passed++;
}

writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2));

console.log(`\n${'═'.repeat(60)}`);
console.log(`📊 评测完成`);
console.log(`总分: ${report.meta.totalScore} / 200 (均分 ${report.meta.avgScore})`);
console.log(`通过率: ${report.meta.passRate} (>= 0.75 算通过)`);
console.log(`耗时: ${elapsed}s (${Math.round(elapsed / 60)} 分钟)`);
console.log(`\n📂 详情: ${OUTPUT_FILE}`);
console.log(`\n各情绪类别得分:`);
for (const [cat, stats] of Object.entries(report.byCategory).sort((a, b) => (b[1].totalScore / b[1].count) - (a[1].totalScore / a[1].count))) {
  const avg = (stats.totalScore / stats.count * 100).toFixed(0);
  const bar = '█'.repeat(Math.round(avg / 5));
  console.log(`  ${cat.padEnd(4)} ${bar} ${avg}% (${stats.passed}/${stats.count})`);
}
