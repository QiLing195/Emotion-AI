// v4.1: 好奇心引擎 — 聚合导出
export type { Interest, InterestModel, Discovery } from './types.js';
export type { EmotionContext } from '../types/shared.js';
export {
    INTEREST_KEYWORDS, INTEREST_STABILITY, INTEREST_CATEGORY,
    EXPLORATION_CYCLE_MS, EXPLORATION_IDLE_MIN,
    EXPLORATION_DAILY_CAP, EXPLORATION_COLD_START_CAP,
    EXPLORATION_COLD_START_MIN_INTERESTS,
    DISCOVERY_SHARE_QUALITY, DISCOVERY_DAILY_SHARE_CAP,
    MAX_DISCOVERIES, EXPLORATION_SEARCH_COUNT,
} from './types.js';

export {
    discoveries, interestModel, CuriosityState,
    getExplorationDailyCap,
    setExplorationTimer, getExplorationTimer,
    getExplorationCountToday, setExplorationCountToday, incrementExplorationCountToday,
    getExplorationDayKey, setExplorationDayKey,
} from './state.js';

export { fetchWebPage, searchWeb, searchForLLM, clearSearchCache } from './search.js';
export type { SearchResult, PageContent, SearchSummary } from './search.js';
export { setCallAI, evaluateDiscovery, aiKnowledgeDiscovery } from './evaluate.js';
export { extractInterests, updateInterestModel, decayInterests, getDayKey } from './interests.js';
export {
  recordMention,
  evaluatePatterns,
  getPatternCandidates,
  getPatternConfirmed,
  getRelevantPatterns,
  getMentionStats,
  resetMentions,
  PatternConfig,
  cosineSimilarity,
  applyDriveBias,
} from './patterns.js';
export type { PatternCandidate, CuriosityStateSnapshot } from './patterns.js';
export { PatternLifecycle } from './patterns.js';
export { isDuplicateDiscovery, scoreDiscovery } from './dedup.js';
export {
  getShareableInsights,
  markInsightShared,
  getUnsharedInsights,
  getInsightStats,
  resetInsights,
  exportInsightState,
  importInsightState,
  DEFAULT_INSIGHT_CONFIG,
} from './insights.js';
export type { Insight, InsightType, InsightConfig, InsightStateSnapshot } from './insights.js';
export {
  initFunnelTracker,
  recordPatternCounts,
  computeDiscoveryYield,
  getFunnelSnapshot,
  logFunnelSummary,
  getFunnelRecommendations,
  resetFunnel,
  getRawCounts,
} from './funnel.js';
export type { FunnelCounts, DiscoveryYield, FunnelSnapshot } from './funnel.js';
export {
    setExploreDeps,
    runExploration, explorationCycle,
    startExplorationCycle, stopExplorationCycle,
} from './explore.js';
