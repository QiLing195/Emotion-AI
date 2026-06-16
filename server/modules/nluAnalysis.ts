// @ts-nocheck
// NLU 文本分析函数 (从 server.ts 抽取, 86行)
// extractEmoji, detectNegation, detectIntensifier, detectSarcasm, analyzeText

import { NEGATIONS, INTENSIFIERS, SARCASM_INDICATORS, EMOJI_MAP } from './constants.js';
import { sentimentLexicon } from './sentimentLexicon.js';

interface AnalyzedResult {
  valence: number; salience: number; dominance: number;
  sarcasmProbability: number; raw_label: string; raw_score: number;
}

function extractEmoji(text: string): { valence: number; arousal: number; dominance: number }[] {
    const results: { valence: number; arousal: number; dominance: number }[] = [];
    for (const emoji of Object.keys(EMOJI_MAP)) {
        if (text.includes(emoji)) {
            results.push(EMOJI_MAP[emoji]);
        }
    }
    return results;
}

/** 否定检测：在匹配位置前扫描否定词 */
function detectNegation(text: string, matchIndex: number): number {
    let totalWeight = 0;
    for (const [pattern, range, weight] of NEGATIONS) {
        // 在 matchIndex 之前的 range 个字符内扫描（多取1字符让 \B 正确工作）
        const searchStart = Math.max(0, matchIndex - range);
        const beforeText = text.slice(searchStart, Math.min(text.length, matchIndex + 1));
        const m = beforeText.match(pattern);
        if (m && m.index !== undefined) {
            // 否定词到匹配词之间有其他词，权重递减
            const dist = matchIndex - (searchStart + m.index);
            const decay = Math.max(0.3, 1 - dist * 0.15);
            totalWeight += weight * decay;
        }
    }
    return totalWeight;
}

/** 程度副词检测：在匹配位置前扫描 */
function detectIntensifier(text: string, matchIndex: number): number {
    const searchStart = Math.max(0, matchIndex - 6);
    const beforeText = text.slice(searchStart, matchIndex);
    let bestFactor = 1.0;
    for (const [pattern, factor] of INTENSIFIERS) {
        if (pattern.test(beforeText)) {
            bestFactor = Math.max(bestFactor, factor);
        }
    }
    return bestFactor;
}

/** 阴阳怪气概率检测 */
function detectSarcasm(text: string): number {
    let score = 0;
    for (const [pattern, weight] of SARCASM_INDICATORS) {
        if (pattern.test(text)) score += weight;
    }
    return Math.min(1, score);
}

/** 新版 analyzeText：否定传播 + 程度副词 + 优先级排序 + Emoji + Dominance */
function analyzeText(text: string): AnalyzedResult {
    const matches: MatchResult[] = [];
    const emojiResults = extractEmoji(text);

    // 1) 词典匹配（带位置信息）
    for (const rule of sentimentLexicon) {
        const m = text.match(rule.pattern);
        if (!m || m.index === undefined) continue;

        // 否定检测（仅当词条允许否定）
        const negWeight = rule.negatable ? detectNegation(text, m.index) : 0;
        // 程度检测
        const intFactor = detectIntensifier(text, m.index);

        // 计算最终效价
        let finalValence = rule.valence;
        if (negWeight < 0) {
            finalValence = -finalValence * Math.abs(negWeight) * 0.7;
        }
        if (intFactor !== 1.0) {
            finalValence *= intFactor;
        }
        finalValence = Math.max(-0.95, Math.min(0.95, finalValence));

        matches.push({
            valence: finalValence,
            arousal: rule.arousal,
            dominance: rule.dominance,
            priority: rule.priority,
            negated: negWeight < 0,
            intensifier: intFactor,
            index: m.index,
            length: m[0].length,
        });
    }

