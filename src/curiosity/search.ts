// ── v5.0: AI 网络搜索引擎 ──
// 多源回退 + LRU 缓存 + 智能正文提取 + 聊天管道集成
import https from 'https';

// ════════════════════════════════════════════════════════
// 1. 类型定义
// ════════════════════════════════════════════════════════

export interface SearchResult {
  title: string;
  snippet: string;
  url: string;
  /** 来源引擎 */
  source: 'duckduckgo_api' | 'duckduckgo_html' | 'bing';
  /** 可信度评分 0-1 */
  credibility?: number;
  /** 可信度标签 */
  credibilityLabel?: 'high' | 'medium' | 'low' | 'unknown';
}

export interface PageContent {
  title: string;
  text: string;
  url: string;
  /** 提取质量 0-1 */
  quality: number;
}

export interface SearchSummary {
  query: string;
  results: SearchResult[];
  /** 可直接注入 LLM 的文本摘要 */
  llmContext: string;
  searchedAt: number;
}

// ════════════════════════════════════════════════════════
// 2. LRU 缓存
// ════════════════════════════════════════════════════════

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 分钟
const MAX_CACHE_SIZE = 100;

interface CacheEntry {
  summary: SearchSummary;
  cachedAt: number;
}

const _cache = new Map<string, CacheEntry>();

function cacheGet(query: string): SearchSummary | null {
  const normalized = query.trim().toLowerCase();
  const entry = _cache.get(normalized);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    _cache.delete(normalized);
    return null;
  }
  return entry.summary;
}

function cacheSet(query: string, summary: SearchSummary): void {
  const normalized = query.trim().toLowerCase();
  if (_cache.size >= MAX_CACHE_SIZE) {
    // 淘汰最旧的条目
    const oldest = [..._cache.entries()].sort((a, b) => a[1].cachedAt - b[1].cachedAt)[0];
    if (oldest) _cache.delete(oldest[0]);
  }
  _cache.set(normalized, { summary, cachedAt: Date.now() });
}

export function clearSearchCache(): void {
  _cache.clear();
}

// ════════════════════════════════════════════════════════
// 3. HTTP 获取
// ════════════════════════════════════════════════════════

function httpGet(url: string, timeoutMs = 10000): Promise<string | null> {
  return new Promise((resolve) => {
    if (!url.startsWith('https://')) { resolve(null); return; }
    const req = https.get(url, {
      timeout: timeoutMs,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    }, (res) => {
      // 跟踪重定向
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        resolve(httpGet(redirectUrl, timeoutMs));
        res.resume();
        return;
      }
      if (res.statusCode !== 200) { res.resume(); resolve(null); return; }
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        try {
          resolve(Buffer.concat(chunks).toString('utf-8'));
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// ════════════════════════════════════════════════════════
// 4. HTML 正文提取
// ════════════════════════════════════════════════════════

function extractPageContent(html: string, url: string): PageContent | null {
  try {
    // 标题
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim().replace(/\s+/g, ' ') : '';

    // 去掉不需要的元素
    let cleaned = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '');

    // 尝试提取 <article> 或 <main> 内容
    const articleMatch = cleaned.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    const mainMatch = cleaned.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
    const targetHtml = articleMatch ? articleMatch[1] : (mainMatch ? mainMatch[1] : cleaned);

    // 去标签
    let text = targetHtml
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&mdash;/g, '—')
      .replace(/&ndash;/g, '–')
      .replace(/\s+/g, ' ')
      .trim();

    // 质量评估：太短或太长的内容质量低
    let quality = 1.0;
    if (text.length < 100) quality = 0.3;
    else if (text.length > 20000) quality = 0.7; // 可能包含大量噪音
    else if (text.length < 500) quality = 0.6;

    // 截断到合理长度
    text = text.substring(0, 6000);

    return { title, text, url, quality };
  } catch {
    return null;
  }
}

// ════════════════════════════════════════════════════════
// 5. 搜索引擎：DuckDuckGo API
// ════════════════════════════════════════════════════════

async function searchDuckDuckGoAPI(query: string): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  try {
    const apiUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const json = await httpGet(apiUrl, 8000);
    if (!json) return results;

    const data = JSON.parse(json);

    // 摘要结果
    if (data.AbstractText && data.AbstractText.trim()) {
      results.push({
        title: data.Heading || query,
        snippet: data.AbstractText.substring(0, 500),
        url: data.AbstractURL || '',
        source: 'duckduckgo_api',
      });
    }

    // 相关主题
    if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
      for (const topic of data.RelatedTopics.slice(0, 5)) {
        if (topic.Text && topic.FirstURL) {
          results.push({
            title: topic.Text.split(' - ')[0] || topic.Text.substring(0, 80),
            snippet: topic.Text.substring(0, 500),
            url: topic.FirstURL,
            source: 'duckduckgo_api',
          });
        }
      }
    }
  } catch { /* API 不可用 */ }
  return results;
}

// ════════════════════════════════════════════════════════
// 6. 搜索引擎：DuckDuckGo HTML（API 回退）
// ════════════════════════════════════════════════════════

async function searchDuckDuckGoHTML(query: string): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  try {
    const htmlUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const html = await httpGet(htmlUrl, 10000);
    if (!html) return results;

    // 解析搜索结果
    const resultBlocks = html.split(/<div class="result /);
    for (const block of resultBlocks.slice(1, 6)) {
      const titleMatch = block.match(/<a[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/i);
      const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);
      const urlMatch = block.match(/href="([^"]*)"/i);

      if (titleMatch && urlMatch) {
        const title = titleMatch[1].replace(/<[^>]+>/g, '').trim();
        const snippet = snippetMatch
          ? snippetMatch[1].replace(/<[^>]+>/g, '').trim()
          : '';
        results.push({
          title: title || '无标题',
          snippet: snippet.substring(0, 500),
          url: urlMatch[1],
          source: 'duckduckgo_html',
        });
      }
    }
  } catch { /* HTML 抓取失败 */ }
  return results;
}

// ════════════════════════════════════════════════════════
// 6b. 搜索引擎：Bing（国内可用回退）
// ════════════════════════════════════════════════════════

async function searchBing(query: string): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  try {
    const searchUrl = `https://cn.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-cn`;
    const html = await httpGet(searchUrl, 10000);
    if (!html) return results;

    // 解析 Bing 搜索结果（cn.bing.com 格式）
    const blocks = html.split(/<li class="b_algo"[^>]*>/);
    for (const block of blocks.slice(1, 7)) {
      // 标题：<h2> 标签内的文本（去标签）
      const h2Match = block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
      // URL：h2 内 a 标签的 href
      const urlMatch = block.match(/<h2[^>]*><a[^>]*href="([^"]*)"[^>]*>/i);
      // 摘要：<p> 标签
      const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);

      if (h2Match) {
        const title = h2Match[1]
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&ensp;/g, ' ').replace(/&#\d+;/g, '')
          .trim();
        const snippet = snippetMatch
          ? snippetMatch[1]
              .replace(/<[^>]+>/g, '')
              .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
              .replace(/&ensp;/g, ' ').replace(/&#\d+;/g, '')
              .trim()
          : '';
        const url = urlMatch ? urlMatch[1] : '';

        if (title.length > 0) {
          results.push({
            title,
            snippet: snippet.substring(0, 500),
            url,
            source: 'bing',
          });
        }
      }
    }
  } catch { /* Bing 不可用 */ }
  return results;
}

// ════════════════════════════════════════════════════════
// 7. 搜索可信度系统
// ════════════════════════════════════════════════════════

/** 域名 → 基础可信度 (0-1)。未知域名默认 0.5。 */
const DOMAIN_CREDIBILITY: Record<string, number> = {
  // 权威来源（政府/教育/百科）
  'baike.baidu.com': 0.90,
  'zh.wikipedia.org': 0.90,
  'en.wikipedia.org': 0.90,
  'news.cctv.com': 0.88,
  'www.xinhuanet.com': 0.88,
  'www.news.cn': 0.88,
  'www.gov.cn': 0.92,
  'edu.cn': 0.85,
  '.edu': 0.85,
  // 高质量技术社区
  'zhuanlan.zhihu.com': 0.65,
  'www.zhihu.com': 0.60,
  'github.com': 0.85,
  'stackoverflow.com': 0.85,
  'developer.mozilla.org': 0.90,
  // 新闻媒体
  'thepaper.cn': 0.75,
  'www.thepaper.cn': 0.75,
  'new.qq.com': 0.65,
  'www.163.com': 0.60,
  'news.sina.com.cn': 0.60,
  'www.ifeng.com': 0.55,
  // 低可信度
  'tieba.baidu.com': 0.35,
  'zhidao.baidu.com': 0.40,
  'wenwen.sogou.com': 0.35,
  'blog.csdn.net': 0.50,
  'juejin.cn': 0.55,
  'segmentfault.com': 0.60,
  // 自媒体平台
  'mp.weixin.qq.com': 0.45,
  'weibo.com': 0.35,
  'douyin.com': 0.30,
  'xiaohongshu.com': 0.30,
};

/** 垃圾/虚假信息域名（直接过滤） */
const BLOCKED_DOMAINS = new Set([
  'baijiahao.baidu.com',  // 百家号（标题党重灾区）
]);

const LOW_CRED_THRESHOLD = 0.40;
const HIGH_CRED_THRESHOLD = 0.75;

function extractDomain(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host;
  } catch {
    return '';
  }
}

function getDomainCredibility(domain: string): number {
  // 精确匹配
  if (DOMAIN_CREDIBILITY[domain] !== undefined) return DOMAIN_CREDIBILITY[domain];
  // 后缀匹配（如 .edu / edu.cn）
  for (const [key, val] of Object.entries(DOMAIN_CREDIBILITY)) {
    if (key.startsWith('.') && domain.endsWith(key)) return val;
  }
  // 默认
  return 0.50;
}

function getCredibilityLabel(score: number): SearchResult['credibilityLabel'] {
  if (score >= HIGH_CRED_THRESHOLD) return 'high';
  if (score >= LOW_CRED_THRESHOLD) return 'medium';
  return 'low';
}

/**
 * 对搜索结果进行可信度评分和过滤。
 * 1. 移除垃圾源
 * 2. 为每条结果打分
 * 3. 按可信度降序排列
 * 4. 过滤极低可信度结果
 */
function applyCredibilityFilter(results: SearchResult[]): SearchResult[] {
  const scored = results
    .filter(r => {
      const domain = extractDomain(r.url);
      if (BLOCKED_DOMAINS.has(domain)) {
        console.log(`[Credibility] 已过滤垃圾源: ${domain}`);
        return false;
      }
      return true;
    })
    .map(r => {
      const domain = extractDomain(r.url);
      let score = getDomainCredibility(domain);

      // 内容信号调整
      const snippet = r.snippet || '';
      // 过短摘要 → 降分
      if (snippet.length < 30) score -= 0.10;
      // 包含"广告"/"推广" → 降分
      if (/广告|推广|赞助|sponsored/i.test(snippet + r.title)) score -= 0.20;
      // 标题党特征 → 降分
      if (/震惊|惊呆|绝了|不看后悔|速删|刚刚曝光|重磅/.test(r.title)) score -= 0.25;
      // 日期偏旧（包含旧年份）→ 轻微降分
      const oldYearMatch = snippet.match(/20(1[0-9]|2[0-3])\s*年/);
      if (oldYearMatch && parseInt(oldYearMatch[1]) < 2024) score -= 0.05;

      score = Math.max(0, Math.min(1, score));

      return {
        ...r,
        credibility: Math.round(score * 100) / 100,
        credibilityLabel: getCredibilityLabel(score),
      };
    });

  // 按可信度排序（同分按摘要长度排）
  scored.sort((a, b) => {
    const diff = (b.credibility || 0) - (a.credibility || 0);
    if (Math.abs(diff) > 0.01) return diff;
    return (b.snippet?.length || 0) - (a.snippet?.length || 0);
  });

  // 过滤极低可信度
  const filtered = scored.filter(r => (r.credibility || 0) >= 0.25);

  if (filtered.length < results.length) {
    console.log(`[Credibility] 过滤了 ${results.length - filtered.length} 条低可信结果（共 ${results.length} 条）`);
  }

  return filtered;
}

/**
 * 计算交叉验证加分：当多个独立来源涉及相同主题时加分。
 * 检测摘要中的关键词重叠来判断是否存在共识。
 */
function computeCrossValidation(results: SearchResult[]): Map<number, number> {
  const bonuses = new Map<number, number>();

  for (let i = 0; i < results.length; i++) {
    const wordsA = extractKeywords(results[i].title + ' ' + (results[i].snippet || ''));
    let overlapCount = 0;

    for (let j = 0; j < results.length; j++) {
      if (i === j) continue;
      const wordsB = extractKeywords(results[j].title + ' ' + (results[j].snippet || ''));
      const overlap = [...wordsA].filter(w => wordsB.has(w)).length;
      if (overlap >= 3) overlapCount++;
    }

    // 2+ 个其他来源有显著重叠 → 加分
    if (overlapCount >= 2) {
      bonuses.set(i, 0.08);
    } else if (overlapCount >= 1) {
      bonuses.set(i, 0.04);
    }
  }

  return bonuses;
}

function extractKeywords(text: string): Set<string> {
  // 提取有意义的词（中文 2+ 字、英文 3+ 字母）
  const words = new Set<string>();
  const chineseWords = text.match(/[一-鿿]{2,}/g) || [];
  const englishWords = text.match(/[a-zA-Z]{3,}/g) || [];
  for (const w of [...chineseWords, ...englishWords]) {
    if (w.length >= 2) words.add(w.toLowerCase());
  }
  return words;
}

// ════════════════════════════════════════════════════════
// 8. 公开 API
// ════════════════════════════════════════════════════════

/**
 * 搜索网页（多源回退：API → HTML）。
 * 结果会被缓存 5 分钟。
 */
export async function searchWeb(query: string): Promise<SearchResult[]> {
  const normalized = query.trim();
  if (!normalized) return [];

  const cached = cacheGet(normalized);
  if (cached) return cached.results;

  // 优先 DuckDuckGo API
  let results = await searchDuckDuckGoAPI(normalized);

  // API 无结果 → DuckDuckGo HTML
  if (results.length === 0) {
    console.log(`[Search] DuckDuckGo API 无结果，尝试 DDG HTML: "${normalized}"`);
    results = await searchDuckDuckGoHTML(normalized);
  }

  // 仍然无结果 → Bing
  if (results.length === 0) {
    console.log(`[Search] DDG HTML 无结果，尝试 Bing: "${normalized}"`);
    results = await searchBing(normalized);
  }

  // 可信度过滤 + 交叉验证
  results = applyCredibilityFilter(results);
  const crossBonuses = computeCrossValidation(results);
  for (const [idx, bonus] of crossBonuses) {
    if (results[idx]) {
      results[idx].credibility = Math.min(1, (results[idx].credibility || 0.5) + bonus);
    }
  }

  // 缓存
  const summary: SearchSummary = {
    query: normalized,
    results,
    llmContext: buildLLMContext(normalized, results),
    searchedAt: Date.now(),
  };
  cacheSet(normalized, summary);

  if (results.length > 0) {
    console.log(`[Search] "${normalized}" → ${results.length} 条结果 (${results[0].source})`);
  } else {
    console.log(`[Search] "${normalized}" → 无结果`);
  }

  return results;
}

/**
 * 获取网页正文内容。
 */
export async function fetchWebPage(url: string, timeoutMs = 10000): Promise<PageContent | null> {
  const html = await httpGet(url, timeoutMs);
  if (!html) return null;
  return extractPageContent(html, url);
}

/**
 * 搜索并直接返回 LLM 可用的上下文摘要。
 * 用于聊天管道中注入实时信息。
 *
 * @param query        搜索查询
 * @param fetchPages   是否抓取前 N 个网页的正文（默认 0，不抓取）
 */
export async function searchForLLM(
  query: string,
  fetchPages: number = 0,
): Promise<SearchSummary> {
  const normalized = query.trim();
  const cached = cacheGet(normalized);
  if (cached) return cached;

  const results = await searchWeb(normalized);
  let llmContext = buildLLMContext(normalized, results);

  // 可选：抓取网页正文
  if (fetchPages > 0 && results.length > 0) {
    const pageContents: string[] = [];
    for (const result of results.slice(0, fetchPages)) {
      if (!result.url) continue;
      const page = await fetchWebPage(result.url, 8000);
      if (page && page.quality > 0.3) {
        pageContents.push(`【${page.title}】\n${page.text.substring(0, 2000)}`);
      }
    }
    if (pageContents.length > 0) {
      llmContext += '\n\n=== 网页正文 ===\n' + pageContents.join('\n---\n');
    }
  }

  const summary: SearchSummary = {
    query: normalized,
    results,
    llmContext,
    searchedAt: Date.now(),
  };
  cacheSet(normalized, summary);

  return summary;
}

// ════════════════════════════════════════════════════════
// 8. 辅助
// ════════════════════════════════════════════════════════

function buildLLMContext(query: string, results: SearchResult[]): string {
  if (results.length === 0) return `关于"${query}"未找到相关搜索结果。`;

  const credLabel = (r: SearchResult) => {
    if (!r.credibilityLabel) return '';
    if (r.credibilityLabel === 'high') return ' [高可信]';
    if (r.credibilityLabel === 'low') return ' [待核实]';
    return '';
  };

  const lines = [
    `以下是关于"${query}"的搜索结果（共 ${results.length} 条，按可信度排序）：`,
    '',
  ];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    lines.push(`${i + 1}. ${r.title}${credLabel(r)}`);
    if (r.snippet) lines.push(`   ${r.snippet}`);
    if (r.url) lines.push(`   来源: ${r.url} (可信度:${((r.credibility || 0.5) * 100).toFixed(0)}%)`);
  }
  lines.push('');
  lines.push('⚠️ 信息使用原则：');
  lines.push('- 标注[高可信]的来源可以放心引用');
  lines.push('- 标注[待核实]的来源请谨慎使用，标注"据网络信息"');
  lines.push('- 如果多个[高可信]来源说法一致，那大概率是准确的');
  lines.push('- 如果信息之间有矛盾，请如实告诉用户存在不同说法');
  lines.push('- 用自然的语气整合信息，不要机械罗列搜索结果');
  return lines.join('\n');
}
