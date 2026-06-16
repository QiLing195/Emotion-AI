// @ts-nocheck
// 好奇心引擎 API 路由 (从 server.ts 抽取, 70行)

import type { Express } from 'express';

export function registerExploreRoutes(
  app: Express,
  discoveries: any[],
  interestModel: any,
  getExplorationCountToday: any,
  getExplorationDayKey: any,
  getExplorationDailyCap: any,
  EXPLORATION_COLD_START_MIN_INTERESTS: any,
  updateInterestModel: any,
  saveAutonomyState: any,
  runExploration: any,
  scoreDiscovery: any,
  MAX_DISCOVERIES: any,
  DISCOVERY_SHARE_QUALITY: any,
  DISCOVERY_DAILY_SHARE_CAP: any,
  startExplorationCycle: any,
  stopExplorationCycle: any,
): void {
// ==================== v3.0: 好奇心引擎端点 ====================

app.get('/api/discoveries', (req, res) => {
    const { topic, shared, limit, sort } = req.query;
    let filtered = [...discoveries];
    if (topic) filtered = filtered.filter(d => d.topic === topic);
    if (shared !== undefined) filtered = filtered.filter(d => d.shared === (shared === 'true'));
    // v3.1: 默认按多因子评分降序
    if (sort !== 'time') {
        filtered.sort((a, b) => scoreDiscovery(b) - scoreDiscovery(a));
    } else {
        filtered.sort((a, b) => b.timestamp - a.timestamp);
    }
    res.json({
        total: discoveries.length,
        unshared: discoveries.filter(d => !d.shared).length,
        items: filtered.slice(0, parseInt(limit as string) || 20),
    });
});

app.get('/api/interests', (req, res) => {
    res.json({
        interests: interestModel.interests,
        lastExploration: interestModel.lastExploration,
        lastDecayDay: interestModel.lastDecayDay,
        explorationCountToday: getExplorationCountToday(),
        explorationDayKey: getExplorationDayKey(),
        dailyCap: getExplorationDailyCap(),
        coldStart: interestModel.interests.length < EXPLORATION_COLD_START_MIN_INTERESTS,
    });
});

app.post('/api/interests/add', (req, res) => {
    const { topic } = req.body;
    if (!topic || typeof topic !== 'string') return res.status(400).json({ error: '需要 topic 参数' });
    updateInterestModel([topic], 'manual');
    saveAutonomyState();
    res.json({ added: topic, interests: interestModel.interests.length });
});

app.post('/api/explore', async (req, res) => {
    const force = req.body?.force === true;
    if (force) {
        // 强制探索：重置当日计数
        setExplorationCountToday(0);
        setExplorationDayKey(getDayKey(Date.now()));
        console.log('[探索] 强制探索模式');
    }
    const idleMs = Date.now() - lastInteractionTime;
    console.log('[探索] 手动触发探索...');
    await runExploration();
    res.json({
        explored: true,
        discoveriesCount: discoveries.length,
        unshared: discoveries.filter(d => !d.shared).length,
        interests: interestModel.interests.length,
        lastExploration: interestModel.lastExploration,
    });
});

app.post('/api/explore/start', (req, res) => {
    startExplorationCycle();
    res.json({ active: getExplorationTimer() !== null, message: '好奇心引擎已启动' });
});

app.post('/api/explore/stop', (req, res) => {
    stopExplorationCycle();
    res.json({ active: false, message: '好奇心引擎已停止' });
});


}
