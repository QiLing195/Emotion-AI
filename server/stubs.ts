// ponytail: extracted from server.ts L97-158
// Stubs — 已删除模块的最小替代（server/modules/ + server/services/ 清理后）

// ── 类型桩 ──
export type AnalyzedResult = any;
export type PhaseState = any;
export type PhaseId = string;
export type TimeState = any;
export type FriendPhaseId = string;
export type FriendState = any;
export type MemoryNode = any;
export type NegationRule = any;
export type SentimentRule = any;
export type MatchResult = any;

// ── NLU 引擎 ──
export const analyzeText = (t: string): AnalyzedResult => ({ sentiment: 'neutral', confidence: 0 });
export const analyze3W = (t: string) => ({ who: '', want: '', why: '', modifiers: '', objectRef: '' });
export const factCheck = (text: string, history?: any) => ({ flags: [] as any[], score: 1, summary: '' });
export const spreadingActivation = (...args: any[]) => [] as any[];
export const detectLifeQuestions = (t: string) => [] as string[];

// ── 语调学习 ──
let _toneStateStub: any = { tones: [], defaultTone: 'neutral' };
let _userPrefStub: any = { preferences: {} };
export const loadToneState = () => _toneStateStub;
export const saveToneState = (s: any) => { _toneStateStub = s; };
export const selectTone = (...args: any[]) => ({ tone: 'neutral', weight: 1 });
export const selectToneByPreference = (...args: any[]) => ({ profile: { id: 'neutral_default', name: '默认', tone: 'neutral', weight: 1 }, reason: 'stub' });
export const feedToneFeedback = (...args: any[]) => {};
export const extractToneContext = (...args: any[]) => ({ mood: 'neutral', intensity: 0 });
export const getTonePromptSnippet = (sel: any) => '';
export const loadUserPreference = () => _userPrefStub;
export const saveUserPreference = (p: any) => { _userPrefStub = p; };
export const updateUserPreference = (...args: any[]) => {};

// ── 情感纠正/中文分析/有害检测 ──
export const detectNegationAndCorrect = (text: string, v: any) => v;
export const detectMockAgreement = (text: string) => null as any;
export const detectPUA = (text: string, phase?: any, time?: any) => ({ score: 0, flags: [] as string[], isPUA: false });
export const detectFriendHarm = (text: string, phase?: any) => ({ score: 0, flags: [] as string[], isHarm: false });
export const classifyRelationship = (text: string) => ({ type: 'neutral', confidence: 0 });
export const detectBanter = (text: string) => ({ isBanter: false, confidence: 0 });
export const isSelfReflection = (text: string) => false;

// ── 阶段引擎 ──
let _phaseStub: any = { currentPhase: 'neutral', history: [] as any[] };
let _timeStub: any = { lastInteraction: Date.now(), silenceHours: 0 };
let _friendStub: any = { currentPhase: 'neutral' };
export const detectPhaseByDuration = (...args: any[]) => 'neutral';
export const inferPhase = (ps: any, vals: any) => ps.currentPhase;
export const createTimeState = () => ({ lastInteraction: Date.now(), silenceHours: 0, activeDays: 0 });
export const updateTimeState = (ts: any) => { _timeStub = ts; };
export const checkSilence = (ts: any, phase: any) => ({ isSilent: false, hours: 0 });
export const getPhaseModulation = (phase: any) => ({ toneModifier: '', expressiveness: 1 });
export const getFriendPhaseModulation = (phase: any) => ({ toneModifier: '', warmth: 1 });
export const inferFriendPhase = (fs: any) => fs.currentPhase;
export const createFriendState = () => ({ currentPhase: 'neutral' as string });

// ── 记忆增强/路由 ──
export const decayAllMemories = (store: any) => ({ archived: [] as any[] });
export const tryConsolidateMemories = (store: any, n: number) => null as any;
export const detectAnchorEvent = (text: string) => null as any;
export const routeMemory = (...args: any[]) => ({ blocks: [] as any[], summary: '' });
export const formatMemoryBlock = (block: any) => '';
