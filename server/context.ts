// ponytail: ServerContext — bundles all shared mutable state
// Extracted from server.ts global scope to enable incremental modularization.

import type { CoreState, Layer2State, CuriosityState, Hypothesis, Experiment,
  TensionRegulatorState, PatternCase, WorldModelData, StrategyDirective, MemoryRecord } from './config.js';
import type { EpisodicMemoryStore } from '../src/lib/episodicMemory.js';
import type { ValueSystem } from '../src/lib/valueDiscovery.js';
import type { MemoryGraph } from '../src/lib/memoryGraph.js';
import type { PhaseState, TimeState, FriendState } from './stubs.js';

// ── Types for state blocks ──

export interface InternalState {
  loneliness: number;
  boredom: number;
  ignoredStreak: number;
  dailyMsgCounts: Record<string, number>;
}

export interface InternalLogEntry {
  timestamp: number;
  type: string;
  summary: string;
}

export interface ProactiveMessage {
  id: string;
  text: string;
  reason: string;
  timestamp: number;
}

export interface SelfModelData {
  patterns: any[];
  metaBeliefs: any[];
}

export interface CompletedExperimentRecord {
  id: string; type: string; risk: string;
  hypothesisId: string; result: string; completedAt: number;
}

export interface RhythmState {
  activeDays: number;
  activeSlots: number[];
  quietHourStart: number;
  quietHourEnd: number;
}

// ── The context object ──

export interface ServerContext {
  // Engine core
  core: CoreState;
  layer2: Layer2State;

  // Memory
  semanticMemory: Map<string, MemoryRecord>;
  episodicStore: EpisodicMemoryStore;
  valueSystem: ValueSystem;
  memoryGraph: MemoryGraph;

  // World / Self
  worldModel: WorldModelData;
  selfModel: SelfModelData;
  tmsState: Record<string, any>;
  hypotheses: Hypothesis[];
  experiments: Experiment[];
  experimentHistory: CompletedExperimentRecord[];
  worldPatterns: PatternCase[];

  // Strategy / Tone
  _lastStrategy: StrategyDirective | null;
  _lastToneId: string | null;
  _lastToneContext: any;
  _lastUserValenceBefore: number;
  _lastTemperature: number;
  _strategyHistory: string[];

  // Curiosity / Meta
  curiosityState: CuriosityState;
  tensionRegulator: TensionRegulatorState;
  _currentInference: any;
  _latestNarrative: string;
  _recentValences: number[];

  // Conflict
  _recentConflictTimestamps: number[];
  _boundaryEscalated: boolean;

  // Phase / Time
  phaseState: PhaseState;
  timeState: TimeState;
  friendState: FriendState;

  // Autonomy
  lastInteractionTime: number;
  lastClosureTs: number;
  internalState: InternalState;
  internalLog: InternalLogEntry[];
  proactiveMessages: ProactiveMessage[];

  // Misc
  _paradigmFreezeRemaining: number;
  _lastConsolidationRound: number;
  conversationMetrics: any;
  puaAnalysisLog: any[];
  conversationHistory: { role: string; text: string }[];
}
