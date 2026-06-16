// 好奇心相关 API 路由 (从 server.ts L5063-5145 抽取)

import type { Express } from 'express';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerCuriosityRoutes(
  app: Express,
  curiosityState: any,
  hypotheses: any[],
  experiments: any[],
  experimentHistory: any[],
  worldPatterns: any[],
  tensionRegulator: any,
): void {
app.get('/api/curiosity', (req, res) => {
    res.json({
        intensity: Math.round(curiosityState.intensity * 1000) / 1000,
        drive: Math.round(curiosityState.drive * 1000) / 1000,
        hypothesisCount: hypotheses.filter(h => h.active).length,
        activeExperiments: experiments.filter(e => e.state === 'active').length,
        pendingExperiments: experiments.filter(e => e.state === 'pending').length,
        tensionRegulator: {
            alphaVMultiplier: Math.round(tensionRegulator.alphaVMultiplier * 1000) / 1000,
            alphaEMultiplier: Math.round(tensionRegulator.alphaEMultiplier * 1000) / 1000,
            familiarity: Math.round(tensionRegulator.familiarity * 1000) / 1000,
            volatility: Math.round(tensionRegulator.volatility * 1000) / 1000,
        },
    });
});

app.get('/api/hypotheses', (req, res) => {
    const byStatus = { active: 0, verified: 0, rejected: 0 };
    for (const h of hypotheses) byStatus[h.status] = (byStatus[h.status] || 0) + 1;
    res.json({
        total: hypotheses.length,
        active: hypotheses.filter(h => h.active).length,
        byStatus,
        hypotheses: hypotheses.map(h => ({
            id: h.id, description: h.description,
            confidence: Math.round(h.confidence * 1000) / 1000,
            valence: h.valence, source: h.source,
            trials: h.trials, confirmations: h.confirmations,
            active: h.active, status: h.status,
        })),
    });
});

app.post('/api/abort-experiments', (req, res) => {
    let count = 0;
    for (const e of experiments) {
        if (e.state === 'active' || e.state === 'pending') {
            e.state = 'aborted';
            count++;
        }
    }
    res.json({ message: `已中止 ${count} 个实验`, aborted: count });
});

app.get('/api/experiments', (req, res) => {
    const limit = Math.min(parseInt(String(req.query.limit || '50')), 200);
    const offset = parseInt(String(req.query.offset || '0'));
    const total = experimentHistory.length;
    const entries = experimentHistory.slice(-limit - offset, -offset || undefined).reverse().slice(0, limit);
    const byOutcome = {
        confirmed: experimentHistory.filter(e => e.hypothesisOutcome === 'confirmed').length,
        disconfirmed: experimentHistory.filter(e => e.hypothesisOutcome === 'disconfirmed').length,
        inconclusive: experimentHistory.filter(e => e.hypothesisOutcome === 'inconclusive').length,
    };
    res.json({
        total, limit, offset,
        byOutcome,
        experiments: entries.map(e => ({
            id: e.id, type: e.type, risk: e.risk,
            hypothesisDesc: e.hypothesisDesc,
            expectedValence: e.expectedValence,
            actualResult: e.actualResult,
            deviation: e.deviation,
            outcome: e.hypothesisOutcome,
            createdAt: e.createdAt,
            completedAt: e.completedAt,
        })),
    });
});

app.get('/api/patterns', (req, res) => {
    res.json({
        total: worldPatterns.length,
        patterns: worldPatterns.map(p => ({
            pattern: p.pattern,
            feature: p.feature,
            sampleCount: p.sampleCount,
            triggerValence: Math.round(p.triggerValence * 1000) / 1000,
            triggerArousal: Math.round(p.triggerArousal * 1000) / 1000,
            typicalOutcome: Math.round(p.typicalOutcome * 1000) / 1000,
        })),
    });
});

}
