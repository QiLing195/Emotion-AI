// v1.0: 好奇心引擎 — 去重 & 检索评分
// 修复：v0.4 中文 bigram Jaccard 阈值过低导致 50-63% 重复率
//   - 提高阈值：同主题 0.7，跨主题 0.85
//   - 时间窗口：同主题只对比 7 天内的发现（旧闻不应挡新闻）
//   - 历史去重：跨主题对比全部发现
import { Discovery, MAX_DISCOVERIES } from './types.js';
import { discoveries, interestModel } from './state.js';

/** 同主题去重窗口（毫秒）—— 7 天内的话题级去重 */
const SAME_TOPIC_DEDUP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function isDuplicateDiscovery(title: string, content: string, topic: string): boolean {
    const extractKeywords = (text: string): Set<string> => {
        const cleaned = text.replace(/[^一-鿿\w]/g, ' ');
        const words = cleaned.split(/\s+/).filter(w => w.length >= 2);
        const chars = text.replace(/[^一-鿿]/g, '');
        for (let i = 0; i < chars.length - 1; i++) {
            words.push(chars.substring(i, i + 2));
        }
        // 截断到 50 个关键词（提升匹配精度）
        return new Set(words.slice(0, 50));
    };

    const newKeys = extractKeywords(title + ' ' + content);
    if (newKeys.size < 3) return false;

    const now = Date.now();
    const windowStart = now - SAME_TOPIC_DEDUP_WINDOW_MS;

    for (const existing of discoveries) {
        const isSameTopic = existing.topic === topic;
        // 同主题 + 旧发现（> 7 天）→ 不阻止新内容进入
        if (isSameTopic && existing.timestamp < windowStart) continue;

        const threshold = isSameTopic ? 0.70 : 0.85;

        const existKeys = extractKeywords(existing.title + ' ' + existing.content);
        const intersection = new Set([...newKeys].filter(k => existKeys.has(k)));
        const union = new Set([...newKeys, ...existKeys]);
        const similarity = intersection.size / union.size;
        if (similarity >= threshold) return true;
    }
    return false;
}

/** 质量淘汰：当 discoveries 满时，移除质量最低的而非最先入的 */
export function evictLowestQuality(): void {
    if (discoveries.length < MAX_DISCOVERIES) return;
    let minIdx = 0;
    let minScore = Infinity;
    for (let i = 0; i < discoveries.length; i++) {
        const s = scoreDiscovery(discoveries[i]);
        if (s < minScore) { minScore = s; minIdx = i; }
    }
    discoveries.splice(minIdx, 1);
}

function scoreDiscovery(d: Discovery): number {
    const now = Date.now();
    const ageHours = (now - d.timestamp) / 3600000;
    const recency = Math.exp(-ageHours / 72);

    const interest = interestModel.interests.find(i => i.topic === d.topic);
    const interestWeight = interest ? interest.weight : 0.1;

    let novelty = 0.5;
    if (d.sourceType === 'web') novelty = d.verified ? 1.0 : 0.8;

    return recency * 0.3 + interestWeight * 0.3 + d.quality * 0.25 + novelty * 0.15;
}

export { isDuplicateDiscovery, scoreDiscovery };
