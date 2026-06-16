// @ts-nocheck
// Autonomy Pilot 路由 (从 server.ts 抽取, 98行)

import type { Express } from 'express';

export function registerAutonomyRoutes(
  app: Express,
  internalLog: any[],
  internalLogEntries: any[],
  internalState: any,
  proactiveMessages: any[],
  proactivePending: any[],
  lastInteractionTime: number,
  autonomousCycle: any,
  saveAutonomyState: any,
  _activeRhythm: any,
  _activityTracker: any[],
  RHYTHM_WINDOW_DAYS: number,
  RHYTHM_EMA_ALPHA: number,
  recalcRhythm: any,
  getAvailabilityFactor: any,
  isQuietHour: any,
  isPostQuietCooldown: any,
  getCurrentThreshold: any,
): void {
// ==================== Autonomy Pilot v1.2 API ====================

app.get('/api/internal-log', (req, res) => {
    const limit = Math.min(parseInt(String(req.query.limit || '20')), 100);
    res.json({
        total: internalLog.length,
        entries: internalLog.slice(-limit).reverse(),
        currentState: {
            loneliness: Math.round(internalState.loneliness * 1000) / 1000,
            boredom: Math.round(internalState.boredom * 1000) / 1000,
            idleMinutes: Math.round((Date.now() - lastInteractionTime) / 60000),
        },
    });
});

app.get('/api/proactive-messages', (req, res) => {
    const unread = proactiveMessages.filter(m => !m.read);
    res.json({
        total: proactiveMessages.length,
        unread: unread.length,
        messages: proactiveMessages.slice(-20).map(m => ({
            id: m.id,
            text: m.text,
            timestamp: m.timestamp,
            trigger: m.trigger,
            read: m.read,
        })),
        idleMinutes: Math.round((Date.now() - lastInteractionTime) / 60000),
        autonomyActive: _autonomyTimer !== null,
    });
});

app.post('/api/mark-proactive-read', (req, res) => {
    const { id } = req.body;
    if (id) {
        const msg = proactiveMessages.find(m => m.id === id);
        if (msg) msg.read = true;
    } else {
        for (const m of proactiveMessages) m.read = true;
    }
    res.json({ marked: true, id: id || 'all' });
});

app.post('/api/autonomous-cycle', (req, res) => {
    autonomousCycle();
    res.json({
        triggered: true,
        idleMinutes: Math.round((Date.now() - lastInteractionTime) / 60000),
        loneliness: Math.round(internalState.loneliness * 1000) / 1000,
        internalLogEntries: internalLog.length,
        proactivePending: proactiveMessages.filter(m => !m.read).length,
    });
});

app.get('/api/rhythm', (req, res) => {
    // 先触发一次重算，确保返回最新节律
    recalcRhythm();
    const allDays = new Set<string>();
    for (const s of _activityTracker.activeDays) for (const d of s) allDays.add(d);
    const zones: string[] = [];
    for (let h = 0; h < 24; h++) {
        const af = getAvailabilityFactor(h);
        const activeDays = _activityTracker.activeDays[h].size;
        const density = allDays.size > 0 ? (activeDays / allDays.size * 100).toFixed(0) : '0';
        let zone: string;
        if (af < 0.1) zone = '工作中/睡眠';
        else if (af < 0.4) zone = '过渡';
        else if (af < 0.7) zone = '可互动';
        else zone = '自由时间';
        zones.push(`${String(h).padStart(2,'0')}:00 x${af.toFixed(2)} ${zone} (${density}%活跃)`);
    }
    res.json({
        totalDaysObserved: allDays.size,
        windowDays: RHYTHM_WINDOW_DAYS,
        rhythm: _activeRhythm,
        zones,
    });
});

app.post('/api/rhythm', (req, res) => {
    const { rhythm, overtime } = req.body;
    if (rhythm && typeof rhythm === 'object') {
        for (const [h, v] of Object.entries(rhythm)) {
            const hour = parseInt(h);
            if (hour >= 0 && hour < 24 && typeof v === 'number') {
                _activeRhythm[hour] = Math.max(0, Math.min(1, v));
            }
        }
    }
    if (overtime) {
        // 手动标记 18-21 为工作时间
        _activeRhythm[18] = 0.05; _activeRhythm[19] = 0.05; _activeRhythm[20] = 0.05;
        _activeRhythm[21] = 0.5; _activeRhythm[22] = 1.0;
    }
    saveAutonomyState();
    res.json({ updated: true, rhythm: _activeRhythm });
});


}
