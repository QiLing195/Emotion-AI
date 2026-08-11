#!/usr/bin/env node
/**
 * 一键评测 + LLM Judge — 从新回复生成到评分
 * Usage: node test_data/eval_full.mjs
 */
import { execSync } from 'child_process';

console.log('═══ Step 1/2: 生成回复 (run_eval.mjs) ═══');
execSync('node test_data/run_eval.mjs', { stdio: 'inherit' });

console.log('\n═══ Step 2/2: LLM Judge 评分 (llm_judge.mjs) ═══');
execSync('node test_data/llm_judge.mjs', { stdio: 'inherit' });

console.log('\n✅ 完成。结果: test_data/eval_llm_judge.json');
