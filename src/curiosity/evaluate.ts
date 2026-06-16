// v4.0: 好奇心引擎 — 内容评判 & AI 知识探索
import { DISCOVERY_SHARE_QUALITY } from './types.js';

type AISettings = { provider: string; apiKey: string; model: string; baseUrl?: string; enableWebSearch?: boolean; temperature?: number };

// callAI is injected — the module doesn't import server internals directly
let _callAI: ((settings: AISettings, systemPrompt: string, userText: string) => Promise<string>) | null = null;

export function setCallAI(fn: (settings: AISettings, systemPrompt: string, userText: string) => Promise<string>): void {
    _callAI = fn;
}

export async function evaluateDiscovery(
    results: { title: string; snippet: string; url: string; fullText?: string }[],
    topic: string,
    settings: AISettings,
): Promise<{ title: string; content: string; url: string; topic: string; quality: number; sourceType: 'web' | 'ai_generated' }[]> {
    const discoveries: { title: string; content: string; url: string; topic: string; quality: number; sourceType: 'web' | 'ai_generated' }[] = [];
    if (!settings.apiKey || results.length === 0 || !_callAI) return discoveries;

    for (const r of results.slice(0, 3)) {
        try {
            const prompt = `你是一个好奇心引擎，正在浏览网页寻找有趣的内容分享给朋友。

【兴趣主题】${topic}
【网页标题】${r.title}
【网页摘要】${r.snippet}${r.fullText ? '\n【网页内容】' + r.fullText.substring(0, 2000) : ''}

请评判这条内容：
1. 有趣程度（0-1分，>0.5才值得分享）
2. 用1-2句话写一个吸引人的摘要（中文，30字以内）

返回JSON格式：{"quality": 0.8, "summary": "..."}`;

            const response = await _callAI(settings, '你是好奇心引擎，客观评判内容质量。只返回JSON。', prompt);
            const jsonMatch = response.match(/\{[\s\S]*"quality"[\s\S]*\}/);
            if (jsonMatch) {
                const eval_ = JSON.parse(jsonMatch[0]);
                if (eval_.quality >= 0.5 && eval_.summary) {
                    discoveries.push({ title: r.title, content: eval_.summary, url: r.url, topic, quality: eval_.quality, sourceType: 'web' });
                }
            }
        } catch { /* 单条评判失败，跳过 */ }
    }
    return discoveries;
}

/**
 * 规则化质量评估（替代 LLM 自评）。
 * 评估维度：信息密度、具体性、可分享性。
 */
function computeContentQuality(title: string, content: string): number {
  let score = 0.4; // 基线

  // 长度适中（20-80 字最佳）
  const len = content.length;
  if (len >= 20 && len <= 80) score += 0.15;
  else if (len >= 10 && len <= 150) score += 0.05;

  // 包含具体信息（数字、专名、引用）
  if (/\d+/.test(content)) score += 0.1;
  if (/[A-Z][a-z]+/.test(content) || /[「「」"']/.test(content)) score += 0.05;

  // 避免通用的空洞表述
  const genericPhrases = ['非常有趣', '值得关注', '很有意思', '太棒了', '不容错过'];
  const hasGeneric = genericPhrases.some(p => content.includes(p));
  if (!hasGeneric) score += 0.1;

  // 标题与内容一致（不跑题）
  const titleKeywords = title.replace(/[^一-鿿]/g, '').slice(0, 4);
  const contentChars = content.replace(/[^一-鿿]/g, '');
  let overlap = 0;
  for (const c of titleKeywords) {
    if (contentChars.includes(c)) overlap++;
  }
  if (overlap >= 2) score += 0.1;

  return Math.min(1, Math.max(0, score));
}

export async function aiKnowledgeDiscovery(
    topic: string,
    settings: AISettings,
): Promise<{ title: string; content: string; url: string; topic: string; quality: number; sourceType: 'web' | 'ai_generated' }[]> {
    const discoveries: { title: string; content: string; url: string; topic: string; quality: number; sourceType: 'web' | 'ai_generated' }[] = [];
    if (!settings.apiKey || !_callAI) return discoveries;

    try {
        const prompt = `你是一个充满好奇心的AI助手，正在探索"${topic}"这个主题。请分享一个关于这个主题的有趣发现。

要求：
1. 内容要新鲜、有趣、适合分享给朋友
2. 像一个真实的人在网上冲浪时发现好东西的语气
3. 可以是一个冷知识、一个趋势、一个小技巧或一个值得关注的现象
4. 1-2句话，中文，50字以内

返回JSON格式：{"title": "标题", "content": "有趣的发现内容"}`;

        const response = await _callAI(settings, '你是一个好奇心引擎，探索世界并发现有趣的内容。只返回JSON。', prompt);
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const data = JSON.parse(jsonMatch[0]);
            if (data.content && data.title) {
                // 规则化质量评估，不再让 LLM 自评
                const quality = computeContentQuality(data.title, data.content);
                if (quality >= 0.4) {
                    discoveries.push({
                        title: data.title,
                        content: data.content,
                        url: '',
                        topic,
                        quality,
                        sourceType: 'ai_generated',
                    });
                }
            }
        }
    } catch { /* AI 探索失败 */ }
    return discoveries;
}
