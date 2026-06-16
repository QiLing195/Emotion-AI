// v4.0: 好奇心引擎 — 兴趣提取 & 模型更新
import { Interest, INTEREST_KEYWORDS, INTEREST_CATEGORY, INTEREST_STABILITY } from './types.js';
import type { EmotionContext } from '../types/shared.js';
import { interestModel } from './state.js';
import { bus } from '../eventBus.js';
import { recordMention } from './patterns.js';

function extractInterests(text: string): string[] {
    const found: string[] = [];
    for (const [topic, keywords] of Object.entries(INTEREST_KEYWORDS)) {
        for (const kw of keywords) {
            if (text.includes(kw)) { found.push(topic); break; }
        }
    }
    return found;
}

function updateInterestModel(
  topics: string[],
  source: Interest['source'],
  emotionCtx?: EmotionContext,
): void {
    const now = Date.now();
    for (const topic of topics) {
        const existing = interestModel.interests.find(i => i.topic === topic);
        if (existing) {
            existing.weight = Math.min(1, existing.weight * 0.9 + 0.1);
            existing.lastUpdated = now;
            if (source !== 'conversation' || existing.source === 'conversation') {
                existing.source = source;
            }
        } else {
            const category = INTEREST_CATEGORY[topic] || 'transient';
            const stability = INTEREST_STABILITY[category];
            interestModel.interests.push({ topic, weight: 0.3, source, firstSeen: now, lastUpdated: now, stability });
        }
    }
    interestModel.interests.sort((a, b) => b.weight - a.weight);
    if (interestModel.interests.length > 30) interestModel.interests.length = 30;

    // v5.1: 录入 Pattern 成熟度 mention 日志（Sprint B-1）
    // Phase 1: 附带情绪上下文，建立情绪签名
    recordMention(topics, Date.now(), emotionCtx);
}

function getDayKey(ts: number): string {
    return new Date(ts).toISOString().slice(0, 10);
}

function decayInterests(): void {
    const todayKey = getDayKey(Date.now());
    if (interestModel.lastDecayDay === todayKey) return;

    let removed = 0;
    for (const interest of interestModel.interests) {
        interest.weight *= (interest.stability || 0.98);
    }
    const before = interestModel.interests.length;
    interestModel.interests = interestModel.interests.filter(i => i.weight >= 0.05);
    removed = before - interestModel.interests.length;

    interestModel.lastDecayDay = todayKey;
    // 兴趣衰减是系统层事件，不属于认知链，不需要 correlationId
    if (removed > 0) bus.emit('InterestDecayed', { removed, remaining: interestModel.interests.length });
    if (removed > 0) {
        console.log(`[探索] 兴趣衰减: 清理${removed}个过期兴趣，剩余${interestModel.interests.length}个`);
    }
}

export { extractInterests, updateInterestModel, decayInterests, getDayKey };
