// v4.0: 好奇心引擎 — 探索循环
import { Discovery, EXPLORATION_CYCLE_MS, EXPLORATION_IDLE_MIN, EXPLORATION_SEARCH_COUNT, MAX_DISCOVERIES, DISCOVERY_SHARE_QUALITY } from './types.js';
import { clock } from '../lib/clock.js';
import {
    discoveries, interestModel,
    getExplorationDailyCap, setExplorationTimer, getExplorationTimer,
    getExplorationCountToday, setExplorationCountToday, incrementExplorationCountToday,
    getExplorationDayKey, setExplorationDayKey,
} from './state.js';
import { fetchWebPage, searchWeb } from './search.js';
import { evaluateDiscovery, aiKnowledgeDiscovery } from './evaluate.js';
import { isDuplicateDiscovery, evictLowestQuality } from './dedup.js';
import { decayInterests, getDayKey } from './interests.js';
import { pruneArchivedPatterns } from './patterns.js';
import { bus } from '../eventBus.js';
import { buildDiscoveryStoredPayload } from './reducer.js';

// External deps injected from server
let _getLastInteractionTime: (() => number) | null = null;
let _readAISettings: (() => any) | null = null;
let _onSaveAutonomyState: (() => void) | null = null;
let _internalLogPush: ((entry: any) => void) | null = null;

export function setExploreDeps(deps: {
    getLastInteractionTime: () => number;
    readAISettings: () => any;
    onSaveAutonomyState: () => void;
    internalLogPush: (entry: any) => void;
}): void {
    _getLastInteractionTime = deps.getLastInteractionTime;
    _readAISettings = deps.readAISettings;
    _onSaveAutonomyState = deps.onSaveAutonomyState;
    _internalLogPush = deps.internalLogPush;
}

let _explorationRunning = false;
let _consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 5;
const FAILURE_COOLDOWN_MS = 60 * 60 * 1000; // 连续失败 5 次后暂停 1 小时
let _failureCooldownUntil = 0;

async function runExploration(): Promise<void> {
    // 熔断保护：连续失败过多次，暂停探索
    if (_failureCooldownUntil > clock.now()) {
        return;
    }
    // 并发保护：如果上一轮探索还在跑，跳过本轮
    if (_explorationRunning) {
        console.log('[探索] 上一轮探索尚未完成，跳过本轮');
        return;
    }
    _explorationRunning = true;
    try {

    const now = clock.now();

    const todayKey = getDayKey(now);
    if (getExplorationDayKey() !== todayKey) {
        setExplorationDayKey(todayKey);
        setExplorationCountToday(0);
        // 每日清理：移除归藏超过 120 天的过期模式
        pruneArchivedPatterns();
    }
    if (getExplorationCountToday() >= getExplorationDailyCap()) return;

    // 开始探索认知链
    bus.startChain();
    const explorationStartedId = bus.emit('ExplorationStarted');

    const topics = interestModel.interests
        .filter(i => i.weight >= 0.2)
        .slice(0, EXPLORATION_SEARCH_COUNT)
        .map(i => i.topic);

    if (topics.length === 0) {
        const defaultTopics = ['美食', '旅行', '科技', '音乐', '电影', '摄影', '读书', '艺术', '宠物'];
        for (const t of defaultTopics.sort(() => Math.random() - 0.5).slice(0, EXPLORATION_SEARCH_COUNT)) {
            if (!topics.includes(t)) topics.push(t);
        }
    }

    const aiEnv = _readAISettings?.() || {};
    const aiSettings = {
        provider: aiEnv.provider || 'deepseek',
        apiKey: aiEnv.apiKey || '',
        model: aiEnv.model || 'deepseek-chat',
        baseUrl: aiEnv.baseUrl || 'https://api.deepseek.com/v1',
        temperature: 0.3,
    };

    let searched = 0;
    for (const topic of topics) {
        if (getExplorationCountToday() >= getExplorationDailyCap()) break;
        incrementExplorationCountToday();
        searched++;

        try {
            const query = `${topic} 最新 有趣 ${new Date().getFullYear()}`;
            const results = await searchWeb(query);

            let newDiscoveries: { title: string; content: string; url: string; topic: string; quality: number; sourceType: 'web' | 'ai_generated' }[] = [];

            if (results.length > 0) {
                const enriched: { title: string; snippet: string; url: string; fullText?: string }[] = [];
                for (const r of results.slice(0, 2)) {
                    const page = await fetchWebPage(r.url, 8000);
                    enriched.push({ ...r, fullText: page?.text });
                }
                newDiscoveries = await evaluateDiscovery(enriched, topic, aiSettings);
            }

            if (newDiscoveries.length === 0 && aiSettings.apiKey) {
                console.log(`[探索] 主题"${topic}"搜索无结果，使用AI知识探索`);
                newDiscoveries = await aiKnowledgeDiscovery(topic, aiSettings);
            }

            let storedCount = 0;
            for (const d of newDiscoveries) {
                if (isDuplicateDiscovery(d.title, d.content, d.topic)) {
                    console.log(`[探索] 跳过重复发现: [${d.topic}] "${d.title.slice(0, 30)}..."`);
                    bus.emit('DiscoveryDuplicateSkipped',
                        { topic: d.topic, title: d.title.slice(0, 40) },
                        { causedBy: explorationStartedId });
                    continue;
                }
                const baseBonus = d.sourceType === 'web' ? 0.05 : 0.02;
                const sameTopicCount = discoveries.filter(ex => ex.topic === d.topic).length;
                const noveltyBonus = sameTopicCount >= 3 ? baseBonus * 0.5 : baseBonus;
                const discovery: Discovery = {
                    id: `disc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                    ...d,
                    quality: Math.min(1, d.quality + noveltyBonus),
                    timestamp: Date.now(),
                    shared: false,
                    verified: false,
                };
                discoveries.push(discovery);
                bus.emit('DiscoveryStored',
                    buildDiscoveryStoredPayload(discovery),
                    { causedBy: explorationStartedId });
                // 高质量发现 → 标记可分享
                if (discovery.quality >= DISCOVERY_SHARE_QUALITY && !discovery.shared) {
                  discovery.shared = true;
                  bus.emit('DiscoveryShared',
                    { topic: discovery.topic, title: discovery.title.slice(0, 40), quality: discovery.quality },
                    { causedBy: explorationStartedId });
                }
                if (discoveries.length >= MAX_DISCOVERIES) evictLowestQuality();
                storedCount++;
            }

            if (storedCount > 0) {
                const bestQ = Math.max(...newDiscoveries.map(d => d.quality));
                const srcTag = newDiscoveries[0]?.sourceType === 'web' ? '(web)' : '(AI)';
                console.log(`[探索] 主题"${topic}"存储 ${storedCount}/${newDiscoveries.length} 条${srcTag}`);
                _internalLogPush?.({
                    timestamp: now,
                    type: 'reflection',
                    summary: `探索"${topic}"${srcTag}: 存储${storedCount}/${newDiscoveries.length}条, 质量最高${bestQ.toFixed(2)}`,
                });
            }
            // 搜索成功 → 重置失败计数
            _consecutiveFailures = 0;
        } catch (e) {
            _consecutiveFailures++;
            console.log(`[探索] 主题"${topic}"搜索失败 (${_consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}):`, (e as Error).message);
        }
    }

    // 熔断保护
    if (_consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        _failureCooldownUntil = clock.now() + FAILURE_COOLDOWN_MS;
        console.log(`[探索] 🔴 连续失败 ${_consecutiveFailures} 次，暂停探索 1 小时`);
        _consecutiveFailures = 0; // 重置计数器，冷却后重新尝试
    }

    if (searched > 0) {
        interestModel.lastExploration = now;
        _onSaveAutonomyState?.();
    }

    // 探索链结束
    bus.emit('ExplorationCompleted', { topicsSearched: searched }, { causedBy: explorationStartedId });
    bus.endChain();

    } finally {
        _explorationRunning = false;
    }
}

function explorationCycle(): void {
    decayInterests();

    const lastInteractionTime = _getLastInteractionTime?.() ?? Date.now();
    const idleMs = Date.now() - lastInteractionTime;
    const idleMinutes = idleMs / 60000;

    if (idleMinutes < EXPLORATION_IDLE_MIN) return;

    const now = Date.now();
    const todayKey = getDayKey(now);
    if (getExplorationDayKey() !== todayKey) {
        setExplorationDayKey(todayKey);
        setExplorationCountToday(0);
    }
    if (getExplorationCountToday() >= getExplorationDailyCap()) return;

    runExploration().catch(e => console.log('[探索] 执行失败:', (e as Error).message));
}

function startExplorationCycle(): void {
    if (getExplorationTimer()) return;
    setExplorationTimer(setInterval(explorationCycle, EXPLORATION_CYCLE_MS));
    console.log('[探索] 好奇心引擎已启动 (每30分钟)');
}

function stopExplorationCycle(): void {
    const timer = getExplorationTimer();
    if (timer) {
        clearInterval(timer);
        setExplorationTimer(null);
        console.log('[探索] 好奇心引擎已停止');
    }
}

export { runExploration, explorationCycle, startExplorationCycle, stopExplorationCycle };
