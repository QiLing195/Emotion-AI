#!/usr/bin/env node
/**
 * Self-Play Bootstrapping 自举循环
 * 生成 → LLM Judge 评分 → 提取 Top-3 示例注入 Prompt → 循环
 * 直到分数不再提升或达到 maxIterations
 */
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const MAX_ITER = 5;
const MIN_IMPROVEMENT = 0.005; // 0.5% 提升才继续

console.log('🔄 Self-Play Bootstrapping 开始\n');

let bestScore = 0;
let bestIter = 0;

for (let iter = 1; iter <= MAX_ITER; iter++) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📌 Iteration ${iter}/${MAX_ITER}`);
  console.log(`${'═'.repeat(60)}\n`);

  // Step 1: Generate responses
  console.log('📝 生成回复...');
  execSync('node test_data/run_eval.mjs', { stdio: 'inherit' });

  // Step 2: LLM Judge scoring
  console.log('⚖️  LLM Judge 评分...');
  execSync('node test_data/llm_judge.mjs', { stdio: 'inherit' });

  // Step 3: Read score
  const judgeData = JSON.parse(readFileSync('test_data/eval_llm_judge.json', 'utf-8'));
  const currentScore = judgeData.meta.avgLLMScore;
  const naturalness = judgeData.results
    .filter(r => r.llmScores?.naturalness !== undefined)
    .reduce((s, r) => s + r.llmScores.naturalness, 0) / judgeData.results.length;

  console.log(`\n📊 Iter ${iter} 结果: LLM均分=${currentScore.toFixed(4)} 自然度=${naturalness.toFixed(1)}/10`);

  if (currentScore > bestScore + MIN_IMPROVEMENT) {
    console.log(`✅ 提升了 ${((currentScore - bestScore) * 100).toFixed(1)}%! 继续下一轮...`);
    bestScore = currentScore;
    bestIter = iter;

    // Step 4: Build new few-shot from latest results
    console.log('🔧 提取新 few-shot 示例...');
    execSync('node test_data/build_fewshot.mjs', { stdio: 'inherit' });

    // Step 5: Write few-shot block for server injection
    const fewshotData = JSON.parse(readFileSync('test_data/fewshot_examples.json', 'utf-8'));
    writeFileSync('test_data/fewshot_block.txt', fewshotData.fewShotBlock);
    console.log(`📏 Few-shot block: ${fewshotData.fewShotBlock.length} 字符`);

    // Save iteration result
    const iterLog = {
      iteration: iter,
      score: currentScore,
      naturalness,
      improvement: currentScore - (bestScore - (currentScore - bestScore)), // previous score
      timestamp: new Date().toISOString(),
    };
    const logPath = 'test_data/bootstrap_log.json';
    const log = existsSync(logPath) ? JSON.parse(readFileSync(logPath, 'utf-8')) : { iterations: [] };
    log.iterations.push(iterLog);
    writeFileSync(logPath, JSON.stringify(log, null, 2));

  } else if (iter === 1) {
    // First iteration: set baseline and continue regardless
    console.log(`📌 基线 ${currentScore.toFixed(4)}，进入第二轮...`);
    bestScore = currentScore;
    bestIter = iter;

    execSync('node test_data/build_fewshot.mjs', { stdio: 'inherit' });
    const fewshotData = JSON.parse(readFileSync('test_data/fewshot_examples.json', 'utf-8'));
    writeFileSync('test_data/fewshot_block.txt', fewshotData.fewShotBlock);

  } else {
    console.log(`⏹️  未提升 (${currentScore.toFixed(4)} <= ${bestScore.toFixed(4)} + ${MIN_IMPROVEMENT})，停止。`);
    break;
  }
}

console.log(`\n${'═'.repeat(60)}`);
console.log(`🏁 Self-Play Bootstrapping 完成`);
console.log(`最佳分数: ${bestScore.toFixed(4)} (Iteration ${bestIter})`);
