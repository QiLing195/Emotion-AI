// @ts-nocheck
// PUA + Phase + Friend 路由 (从 server.ts 抽取, 115行)

import type { Express } from 'express';

export function registerAnalysisRoutes(
  app: Express,
  puaLog: any[],
  episodicStore: any,
  phaseState: any,
  friendState: any,
  core: any,
  layer2: any,
): void {
// ==================== PUA 分析接口 ====================
app.get('/api/pua-log', (req, res) => {
    const limit = Math.min(parseInt(String(req.query.limit || '50')), 500);
    res.json({ total: puaAnalysisLog.length, entries: puaAnalysisLog.slice(-limit) });
});

// 纯 PUA 分析（不修改引擎状态，支持阶段感知）
app.post('/api/pua-analyze', (req, res) => {
    const { text, phase } = req.body;
    if (!text || typeof text !== 'string') return res.status(400).json({ error: '需要 { text }' });
    const effectivePhase: PhaseId = phase || phaseState.currentPhase;
    const silence = checkSilence(timeState, effectivePhase);
    res.json({
        text,
        phase: effectivePhase,
        silenceDetected: silence.silent,
        silenceHours: silence.hours,
        ...detectPUA(text, effectivePhase, timeState),
    });
});

// 阶段信息接口
app.get('/api/phase', (req, res) => {
    const silence = checkSilence(timeState, phaseState.currentPhase);
    res.json({
        phase: phaseState.currentPhase,
        confidence: phaseState.confidence,
        relationshipStartDate: phaseState.relationshipStartDate,
        daysSinceStart: phaseState.relationshipStartDate > 0
            ? Math.floor((Date.now() - phaseState.relationshipStartDate) / 86400000) : 0,
        totalMessages: phaseState.totalMessages,
        keyEvents: phaseState.phaseKeyEvents,
        silenceDetected: silence.silent,
        silenceHours: silence.hours,
        silenceThreshold: silence.threshold,
        phaseHistory: phaseState.phaseHistory,
        responseTimeAvg: timeState.responseTimes.length > 0
            ? Math.round(timeState.responseTimes.reduce((a, b) => a + b, 0) / timeState.responseTimes.length) : null,
    });
});

// ─── 友谊阶段信息接口 ───
app.get('/api/friend-phase', (req, res) => {
    const bal = friendState.myInitCount + friendState.theirInitCount;
    res.json({
        phase: friendState.currentPhase,
        confidence: friendState.confidence,
        friendSinceDays: friendState.friendSinceDate > 0
            ? Math.floor((Date.now() - friendState.friendSinceDate) / 86400000) : 0,
        totalMessages: friendState.totalMessages,
        keyEvents: friendState.keyFriendEvents,
        initiatorRatio: bal > 0 ? Math.round((friendState.myInitCount / bal) * 100) / 100 : 0.5,
        myInitCount: friendState.myInitCount,
        theirInitCount: friendState.theirInitCount,
        recentBanterCount: friendState.recentBanterCount,
        phaseHistory: friendState.phaseHistory,
    });
});

// ─── 友谊纯分析接口（不修改引擎状态） ───
app.post('/api/friend-analyze', (req, res) => {
    const { text, phase } = req.body;
    if (!text || typeof text !== 'string') return res.status(400).json({ error: '需要 { text }' });
    const effectivePhase: FriendPhaseId = phase || friendState.currentPhase;
    const result = detectFriendHarm(text, effectivePhase);
    const relClass = classifyRelationship(text);
    const banter = detectBanter(text);
    res.json({
        text,
        friendPhase: effectivePhase,
        relationshipClass: relClass,
        banter,
        ...result,
    });
});

// ─── 关系类型分类接口 ───
app.post('/api/classify-relationship', (req, res) => {
    const { text } = req.body;
    if (!text || typeof text !== 'string') return res.status(400).json({ error: '需要 { text }' });
    res.json({
        text,
        ...classifyRelationship(text),
        banter: detectBanter(text),
    });
});

// ═══ 时间扭曲接口（测试用，模拟时间流逝以触发沉默检测）═══
app.post('/api/time-warp', (req, res) => {
    const { hoursBack, setPhase, addEvent } = req.body;
    if (typeof hoursBack === 'number' && hoursBack > 0) {
        timeState._silenceOverrideHours = hoursBack;
        timeState.consecutiveSilenceHours = Math.max(0, hoursBack - 0.5);
        // Autonomy v1.2: also backdate lastInteractionTime
        lastInteractionTime = Date.now() - hoursBack * 3600000;
    }
    if (setPhase) {
        phaseState.currentPhase = setPhase as PhaseId;
        phaseState.lastPhaseTransition = Date.now();
    }
    if (addEvent && typeof addEvent === 'string' && !phaseState.phaseKeyEvents.includes(addEvent)) {
        phaseState.phaseKeyEvents.push(addEvent);
    }
    const silence = checkSilence(timeState, phaseState.currentPhase);
    res.json({
        message: 'time-warp applied',
        hoursBack: hoursBack || 0,
        phase: phaseState.currentPhase,
        silenceDetected: silence.silent,
        silenceHours: silence.hours,
        silenceThreshold: silence.threshold,
        keyEvents: phaseState.phaseKeyEvents,
    });
});


}
