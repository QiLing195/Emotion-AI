// 本地规则 NLU 的强度刻度（只读探针，不写任何状态）
//
// 用途：`DISABLE_LLM_NLU=true`（省 API）时，用户情绪强度完全由本地词典给出。
// 本脚本把这把尺子对常见句子的读数打出来 —— 它是「本地规则 NLU 词表偏窄」这条技术债的**证据**，
// 也是 v1.27 那个坑的前置条件：
//
//   实测（2026-09）：这类明确负面的话本地词典只给 **0.04~0.10**，
//   而 `dialogueStrategy` 的 `HIGH_EMOTION_THRESHOLD = 0.7` 是给 **LLM NLU** 定的量级
//   ⇒ 一旦关掉 LLM NLU，"他情绪强烈"这条分支**永远进不去**（`empathize`/`accompany` 全不可达）。
//   也就是说：省 API 与"她能不能看出他情绪强烈"目前是互斥的。
//
// 用法: node node_modules/tsx/dist/cli.mjs scripts/probe-local-nlu.ts

import { analyzeUserEmotionLocally } from '../server/services/emotionAnalyzer.js';

const CANDIDATES = [
  '我今天面试又挂了，感觉自己挺没用的',
  '我今天真的撑不住了，什么都做不好，特别难受',
  '我今天特别难过，什么都做不好',
  '我好累，感觉整个人都空了，什么都不想干',
  '我真的好难受，感觉快崩溃了，撑不下去了',
  '今天上班好累，被老板说了两句',
  '气死我了，他凭什么这样！',
];

console.log('本地规则 NLU 的读数（强度 / 标签 / 判据）：\n');
for (const text of CANDIDATES) {
  const a = analyzeUserEmotionLocally(text) as unknown as {
    intensity: number; expressedEmotion?: string; likelyCause?: string;
  };
  console.log(`${a.intensity.toFixed(2)}  ${String(a.expressedEmotion ?? '?').padEnd(9)} ${String(a.likelyCause ?? '').padEnd(12)} ${text}`);
}
console.log('\n对比：`HIGH_EMOTION_THRESHOLD = 0.7`（共情/陪伴分支的门限，按 **LLM NLU** 的 0.1 量化刻度标定）');
