// server.ts 全局状态上下文
// 将所有模块级变量集中管理，为模块化拆分扫清障碍
// 创建: 2026-06-16

export interface ServerContext {
  // 核心情感状态
  core: any;
  layer2: any;

  // 记忆系统
  semanticMemory: Map<string, any>;
  episodicStore: any;
  valueSystem: any;

  // 元认知
  curiosityState: any;
  hypotheses: any[];
  experiments: any[];
  experimentHistory: any[];
  tensionRegulator: any;
  worldPatterns: any[];

  // 世界模型 & 自我模型
  worldModel: any;
  selfModel: any;
  paradigmHistory: any[];

  // 策略与情感
  strategyEffectiveness: Map<string, any>;
  _lastStrategy: any;
  _lastTemperature: number;
  _strategyHistory: any[];
  _latestNarrative: string;
  _recentValences: number[];

  // 冲突追踪
  _recentConflictTimestamps: number[];
  _boundaryEscalated: boolean;
  conflictFreq: number;

  // 自主循环
  internalState: any;
  internalLog: any[];
  internalLogEntries: any[];
  proactiveMessages: any[];
  proactivePending: any[];
  _activityTracker: any[];
  _activeRhythm: any;

  // 其他
  phaseState: any;
  friendState: any;
  toneState: any;
  _lastToneId: string | null;
  _lastToneContext: any;
  _lastUserValenceBefore: number;

  // 定时器
  _memSaveTimer: any;
  _memPeriodicTimer: any;
  _autonomyTimer: any;

  // 节律
  lastInteractionTime: number;
  lastClosureTs: number;
}
