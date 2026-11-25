// 本地 NLU 强度刻度探针（只读、不写状态、不调用 API）。
// 它检查普通/强烈/混合表达是否与 dialogueStrategy 的 0.7 强情绪门限大致对齐。
// 转述场景不得因原话中的强烈词语而被提升为当前用户的强烈情绪。
// 用法: npx tsx scripts/probe-local-nlu.ts

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
