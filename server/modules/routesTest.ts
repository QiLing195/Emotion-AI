// @ts-nocheck
// Tick + Reset 路由 (从 server.ts 抽取, 60行)

import type { Express } from 'express';

export function registerTestRoutes(
  app: Express,
  core: any,
  layer2: any,
  episodicStore: any,
  valueSystem: any,
  worldModel: any,
  selfModel: any,
  curiosityState: any,
  tensionRegulator: any,
  hypotheses: any[],
  experiments: any[],
  worldPatterns: any[],
  internalState: any,
  _recentValences: number[],
  _lastStrategy: any,
  _lastTemperature: number,
): void {
app.post('/tick', (req, res) => {
    const { steps = 1 } = req.body;
    for (let i = 0; i < steps; i++) {
        core.valence *= P.DECAY_V;
        core.arousal = core.arousal * P.DECAY_A + P.BASELINE_A * (1 - P.DECAY_A);
        core.expectation *= P.DECAY_E;
        processReversal(core);
        layer2.tick++;
        // 好奇心在无事件时衰减（沉默消耗好奇）
        curiosityState.intensity *= P.CURIOSITY_DECAY;
        // 范革冻结期衰减
        if (_paradigmFreezeRemaining > 0) _paradigmFreezeRemaining--;
    }
    res.json(buildFullResponse(core, layer2));
});

app.post('/reset', (req, res) => {
    const c = req.body || {};
    core = {
        valence: c.valence ?? 0, arousal: c.arousal ?? 0.2, expectation: c.expectation ?? 0,
        dominance: 0, extremityDuration: 0, lastExtremitySign: 0, _trend: 0, _valenceHistory: [],
    };
    layer2 = {
        apologyCredit: c.apologyCredit ?? 1.0, recentTraumaCount: c.recentTraumaCount ?? 0,
        tick: c.tick ?? 0, baseline: 0, resilience: 1,
    };
    core.valence = clamp(core.valence, -0.95, 0.95);
    core.arousal = clamp(core.arousal, 0.05, 0.95);
    core.expectation = clamp(core.expectation, -0.8, 0.8);
    layer2.apologyCredit = clamp(layer2.apologyCredit, 0, 1);
    layer2.recentTraumaCount = clamp(layer2.recentTraumaCount, 0, 10);
    timeState._silenceOverrideHours = undefined; // 清除测试用沉默覆盖
    if (c.clearMemory) { semanticMemory.clear(); try { fs.unlinkSync(MEMORY_FILE); } catch {} }
    if (c.clearPhase) {
        phaseState = {
            currentPhase: 'R1', confidence: 0.5,
            relationshipStartDate: 0,
            lastPhaseTransition: Date.now(),
            phaseHistory: [{ phase: 'R1', timestamp: Date.now() }],
            totalMessages: 0,
            dailyMessageHistory: [],
            phaseKeyEvents: [],
        };
        timeState = createTimeState();
        _recentValences.length = 0;
        friendState = createFriendState();
        _recentMessages.length = 0;
    }
    // Autonomy v2.0: reset autonomy state
    lastInteractionTime = Date.now();
    lastClosureTs = 0;
    internalState = { loneliness: 0, boredom: 0, ignoredStreak: 0, dailyMsgCounts: {} };
    internalLog.length = 0;
    proactiveMessages.length = 0;
    newSignificantPattern = null;
    // v2.1: reset rhythm tracker
    _activeRhythm = { ...DEFAULT_RHYTHM };
    _activityTracker = { activeDays: Array.from({ length: 24 }, () => new Set<string>()), lastRecalc: 0 };
    res.json({ message: 'reset', state: buildFullResponse(core, layer2), memoryCleared: !!c.clearMemory, phaseCleared: !!c.clearPhase });
});

}
