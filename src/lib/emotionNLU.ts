// ── 情感 NLU (Natural Language Understanding) — 从 emotionEngine.ts 提取 ──
// 关键词匹配的情感分析和依恋风格分类

import type { UserEmotionAnalysis } from './emotionTypes';

/** 依恋风格分类器 — 从行为模式推断用户依恋风格 */
export function classifyAttachmentStyle(
  valenceVolatility: number,
  topicSwitchRate: number,
  intimacySeekingRate: number,
  messageFreqVolatility: number,
): { style: 'secure' | 'anxious' | 'avoidant'; anxiety: number; avoidance: number } {
  // 焦虑得分：高情绪波动 + 高亲密寻求
  const anxiety = Math.min(1, valenceVolatility * 0.6 + intimacySeekingRate * 0.4);
  // 回避得分：高话题切换 + 低亲密寻求 + 频率波动
  const avoidance = Math.min(1, topicSwitchRate * 0.5 + (1 - intimacySeekingRate) * 0.3 + messageFreqVolatility * 0.2);

  let style: 'secure' | 'anxious' | 'avoidant';
  if (anxiety < 0.35 && avoidance < 0.35) {
    style = 'secure';
  } else if (anxiety >= avoidance) {
    style = 'anxious';
  } else {
    style = 'avoidant';
  }
  return { style, anxiety, avoidance };
}

/** 基于关键词的用户情感分析（本地快速通道，无需 LLM） */
export function analyzeUserSentiment(text: string): UserEmotionAnalysis {
  const t = text.trim();
  const patterns: { emotion: string; keywords: string[]; cause: string }[] = [
    { emotion: 'joy',    keywords: ['开心', '高兴', '哈哈', '嘻嘻', '好开心', '太棒了', '真好', '快乐', '爽'], cause: '遇到了开心的事' },
    { emotion: 'love',   keywords: ['爱你', '喜欢你', '想你', '亲', '抱', '爱', '喜欢', '么么', '宝贝'], cause: '对你有感情表达' },
    { emotion: 'anger',  keywords: ['生气', '烦', '讨厌', '滚', '气死', '受不了', '可恶', '有病', '无语'], cause: '对某事感到不满' },
    { emotion: 'sad',    keywords: ['难过', '伤心', '哭', '不开心', '低落', '忧郁', '悲伤', '委屈', '心累'], cause: '遇到了伤心事' },
    { emotion: 'fear',   keywords: ['害怕', '担心', '怕', '紧张', '焦虑', '慌', '不安', '恐惧'], cause: '感到担心或害怕' },
    { emotion: 'disgust', keywords: ['恶心', '讨厌', '反感', '受不了', '恶心死了', '烦人'], cause: '对某事感到反感' },
    { emotion: 'gratitude', keywords: ['谢谢', '多谢', '感谢', '辛苦', '你真好', '太感谢'], cause: '对你表示感谢' },
    { emotion: 'neutral', keywords: ['嗯', '好的', '哦', '知道了', '行', '可以'], cause: '日常交流' },
  ];

  let bestMatch = { emotion: 'neutral', score: 0, cause: '日常交流' };
  for (const p of patterns) {
    let score = 0;
    for (const kw of p.keywords) {
      if (t.includes(kw)) score += 1.0 / p.keywords.length;
    }
    if (score > bestMatch.score) bestMatch = { emotion: p.emotion, score, cause: p.cause };
  }

  const directedAtAI = ['你', '你让', '你给', '你总是', '你从来'].some(w => t.includes(w));
  const intensity = Math.min(1, bestMatch.score * 0.5 + Math.min(1, t.length / 100) * 0.3 + ((t.match(/[！!]/g)?.length ?? 0) * 0.2));

  return { expressedEmotion: bestMatch.emotion, likelyCause: bestMatch.cause + (directedAtAI ? '，且与你有关' : ''), intensity: Math.round(intensity * 100) / 100, directedAtAI };
}
