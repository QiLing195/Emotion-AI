// @ts-nocheck
// 人格/记忆/价值/身份 API 路由 (从 server.ts L5231-5298 抽取)

import type { Express } from 'express';

export function registerDataRoutes(
  app: Express,
  core: any,
  layer2: any,
  semanticMemory: Map<string, any>,
  worldModel: any,
  deriveApproachAvoid: (c: any) => { approachBias: number; avoidBias: number },
  metrics: any,
  buildFullResponse: (c: any, l: any) => any,
  episodicStore: any,
  valueSystem: any,
  clamp: (v: number, lo: number, hi: number) => number,
  _latestNarrative: string,
  computeNineEmotions: any,
  readEmotion: any,
): void {
app.get('/api/metrics', (req, res) => {
    const full = buildFullResponse(core, layer2);
    res.json(metrics.getSnapshot(
        core.valence,
        core.arousal,
        full.dominant || 'neutral',
    ));
});

// ==================== v1.1: 人格/记忆/价值/身份 API ====================

app.get('/api/personality', (req, res) => {
    const { approachBias, avoidBias } = deriveApproachAvoid(core);
    res.json({
        empathy: Math.round(clamp((approachBias - avoidBias) * 0.5 + 0.5, 0.1, 1) * 1000) / 1000,
        sensitivity: Math.round(clamp(core.arousal, 0.1, 1) * 1000) / 1000,
        trustInclination: Math.round(clamp(core.expectation * 0.5 + 0.5, 0.1, 1) * 1000) / 1000,
        resilience: Math.round(clamp(layer2.resilience, 0.1, 1) * 1000) / 1000,
        openness: Math.round(clamp(approachBias, 0.1, 1) * 1000) / 1000,
        playfulness: Math.round(clamp(core.arousal * 0.5 + Math.max(0, core.valence) * 0.5, 0.1, 1) * 1000) / 1000,
        attachmentStyle: approachBias > 0.65 ? 'secure' : approachBias > 0.45 ? 'anxious' : 'avoidant',
        conflictStyle: avoidBias > 0.6 ? 'avoidant' : approachBias > 0.6 ? 'collaborative' : 'defensive',
    });
});

app.get('/api/memories', (req, res) => {
    const list = Array.from(semanticMemory.entries())
        .map(([phrase, record]) => ({
            phrase,
            totalValence: Math.round(record.totalValence * 1000) / 1000,
            occurrences: record.occurrences,
            avgValence: Math.round((record.totalValence / record.occurrences) * 1000) / 1000,
            lastSeen: new Date(record.lastSeen).toISOString(),
        }))
        .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))
        .slice(0, 20);
    res.json(list);
});

app.get('/api/values', (req, res) => {
    const activeBeliefs = worldModel.beliefs.filter(b => b.status === 'active');
    res.json(activeBeliefs.map(b => ({
        id: b.id,
        statement: b.consequent,
        confidence: Math.round(b.confidence * 1000) / 1000,
        antecedent: b.antecedent,
    })));
});

app.get('/api/identity', (req, res) => {
    const { approachBias, avoidBias } = deriveApproachAvoid(core);
    const narrative = _latestNarrative || '我还在学习如何描述自己。';
    const activeBeliefs = worldModel.beliefs.filter(b => b.status === 'active');
    const bias = approachBias - avoidBias;
    const emotions = computeNineEmotions(core, bias);
    const { dominant } = readEmotion(core, emotions, layer2);

    res.json({
        narrative,
        personalitySummary: {
            empathy: Math.round(clamp((approachBias - avoidBias) * 0.5 + 0.5, 0.1, 1) * 1000) / 1000,
            trustInclination: Math.round(clamp(core.expectation * 0.5 + 0.5, 0.1, 1) * 1000) / 1000,
            resilience: Math.round(clamp(layer2.resilience, 0.1, 1) * 1000) / 1000,
        },
        currentEmotion: dominant,
        memoryCount: semanticMemory.size,
        valueCount: activeBeliefs.length,
    });
}
