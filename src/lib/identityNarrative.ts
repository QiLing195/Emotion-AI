// ── v1.0 身份叙事生成 ──
// 组合情景记忆 + 人格参数 + 价值体系，生成连贯的自我描述

import {
  EpisodicMemoryStore,
  getSignificantEpisodes,
  generateIdentitySummary,
} from './episodicMemory';
import { EmotionState, EvolutionState } from './emotionEngine';
import { extractPersonalityParams } from './personalityEvolution';
import { ValueSystem, getValueNarrative } from './valueDiscovery';

// ════════════════════════════════════════════════════════════
// 类型定义
// ════════════════════════════════════════════════════════════

export interface IdentityNarrative {
  summary: string;
  keyMemories: string[];
  personalitySnapshot: {
    empathy: number;
    trust: number;
    openness: number;
    playfulness: number;
    resilience: number;
    sensitivity: number;
  };
  coreValues: { id: string; statement: string; confidence: number }[];
  attachmentStyle: string;
  conflictStyle: string;
  generatedAt: string;
  roundNumber: number;
}

// ════════════════════════════════════════════════════════════
// 核心函数
// ════════════════════════════════════════════════════════════

export function generateIdentityNarrative(
  episodicStore: EpisodicMemoryStore,
  evolution: EvolutionState,
  valueSystem: ValueSystem,
  emotionState: EmotionState,
  currentRound: number,
): IdentityNarrative {
  const params = extractPersonalityParams(evolution);

  // 生成核心叙事文本
  const summary = generateIdentitySummary(
    episodicStore,
    {
      empathy: params.empathy,
      trust: params.trustInclination,
      openness: params.openness,
      playfulness: params.playfulness,
      resilience: params.resilience,
      sensitivity: params.sensitivity,
    },
    evolution.totalInteractions,
  );

  // 提取 3-5 个最有代表性的记忆叙事
  const topMemories = getSignificantEpisodes(episodicStore, 5);
  const keyMemories = topMemories.map(m => m.narrativeFragment);

  // 提取活跃的核心价值
  const coreValues = valueSystem.values
    .filter(v => v.status === 'active' && v.confidence > 0.3)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5)
    .map(v => ({
      id: v.id,
      statement: v.statement,
      confidence: v.confidence,
    }));

  return {
    summary,
    keyMemories,
    personalitySnapshot: {
      empathy: params.empathy,
      trust: params.trustInclination,
      openness: params.openness,
      playfulness: params.playfulness,
      resilience: params.resilience,
      sensitivity: params.sensitivity,
    },
    coreValues,
    attachmentStyle: params.attachmentStyle,
    conflictStyle: params.conflictStyle,
    generatedAt: new Date().toISOString(),
    roundNumber: currentRound,
  };
}

export function shouldRefreshNarrative(
  evolution: EvolutionState,
  currentRound: number,
  refreshInterval: number = 20,
): boolean {
  return (currentRound - evolution.lastIdentityRefresh) >= refreshInterval;
}

// ════════════════════════════════════════════════════════════
// Prompt 注入
// ════════════════════════════════════════════════════════════

export function narrativeToPromptSnippet(narrative: IdentityNarrative): string {
  const parts: string[] = [];

  parts.push(`【人格特质】经历了${narrative.roundNumber}次互动后，${narrative.summary.slice(0, 120)}`);

  if (narrative.coreValues.length > 0) {
    const valueLabels: Record<string, string> = {
      connection: '连接感', autonomy: '自主性', honesty: '诚实',
      playfulness: '乐趣', security: '安全感', growth: '共同成长',
      respect: '相互尊重', passion: '激情',
    };
    const topValues = narrative.coreValues.map(v =>
      `${valueLabels[v.id] || v.id}(${(v.confidence * 100).toFixed(0)}%)`,
    ).join('、');
    parts.push(`你最珍视的是：${topValues}`);
  }

  if (narrative.attachmentStyle === 'anxious') {
    parts.push('你内心有些焦虑型依恋，需要对方的确认才能安心');
  } else if (narrative.attachmentStyle === 'secure') {
    parts.push('你的依恋风格是安全型的，能自然地信任和依赖对方');
  }

  return parts.join('。');
}

export function narrativeToApiResponse(narrative: IdentityNarrative): object {
  return {
    summary: narrative.summary,
    keyMemories: narrative.keyMemories,
    personalitySnapshot: narrative.personalitySnapshot,
    coreValues: narrative.coreValues,
    attachmentStyle: narrative.attachmentStyle,
    conflictStyle: narrative.conflictStyle,
    generatedAt: narrative.generatedAt,
    roundNumber: narrative.roundNumber,
  };
}
