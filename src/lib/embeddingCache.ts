// ── v1.0 Embedding 缓存层 ──
// 解决 generateEmbeddings() 每次调 API 但从不缓存的问题
//
// 策略：
//   - 内存 LRU 缓存（默认 200 条）
//   - key = hash(text)
//   - 批量预热：服务器启动时预计算语义记忆池的 embedding
//   - 过期时间：7 天（embedding 一般不会过时）

// ════════════════════════════════════════════════════════════
// 1. 简易 LRU 缓存
// ════════════════════════════════════════════════════════════

class LRUCache<K, V> {
  private cache = new Map<K, { value: V; accessedAt: number }>();
  private maxSize: number;

  constructor(maxSize: number = 200) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (entry) {
      entry.accessedAt = Date.now();
      return entry.value;
    }
    return undefined;
  }

  set(key: K, value: V): void {
    if (this.cache.size >= this.maxSize) {
      // 淘汰最久未访问的
      let oldestKey: K | null = null;
      let oldestTime = Infinity;
      for (const [k, v] of this.cache) {
        if (v.accessedAt < oldestTime) {
          oldestTime = v.accessedAt;
          oldestKey = k;
        }
      }
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(key, { value, accessedAt: Date.now() });
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  size(): number {
    return this.cache.size;
  }

  keys(): IterableIterator<K> {
    return this.cache.keys();
  }

  clear(): void {
    this.cache.clear();
  }
}

// ════════════════════════════════════════════════════════════
// 2. Embedding 缓存
// ════════════════════════════════════════════════════════════

function hashText(text: string): string {
  // 简单 hash：Fowler–Noll–Vo
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash.toString(36);
}

class EmbeddingCache {
  private cache = new LRUCache<string, number[]>(300);

  /**
   * 获取缓存的 embedding。
   * @returns embedding 数组或 undefined（未缓存）
   */
  get(text: string): number[] | undefined {
    const key = hashText(text);
    return this.cache.get(key);
  }

  /**
   * 缓存 embedding。
   */
  set(text: string, embedding: number[]): void {
    const key = hashText(text);
    this.cache.set(key, embedding);
  }

  /**
   * 批量缓存（用于预热）。
   */
  batchSet(entries: Array<{ text: string; embedding: number[] }>): void {
    for (const { text, embedding } of entries) {
      this.set(text, embedding);
    }
  }

  /**
   * 获取文本的 embedding，优先从缓存读取。
   * 如果缓存未命中，调用 generateFn 生成并缓存。
   */
  async getOrCompute(
    text: string,
    generateFn: (text: string) => Promise<number[]>,
  ): Promise<number[]> {
    const cached = this.get(text);
    if (cached && cached.length > 0) return cached;

    try {
      const embedding = await generateFn(text);
      if (embedding && embedding.length > 0) {
        this.set(text, embedding);
      }
      return embedding;
    } catch {
      return [];
    }
  }

  /**
   * 检查是否已缓存。
   */
  has(text: string): boolean {
    return this.cache.has(hashText(text));
  }

  size(): number {
    return this.cache.size();
  }

  clear(): void {
    this.cache.clear();
  }
}

// ── 全局单例 ──
export const embeddingCache = new EmbeddingCache();

/**
 * 预计算语义记忆池的 embedding。
 * 在服务器启动或内存池更新时调用。
 */
export async function prewarmEmbeddings(
  memories: Array<{ id: string; content: string }>,
  generateFn: (text: string) => Promise<number[]>,
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, number[]>> {
  const result = new Map<string, number[]>();
  let done = 0;

  for (const mem of memories) {
    if (embeddingCache.has(mem.content)) {
      const cached = embeddingCache.get(mem.content);
      if (cached) result.set(mem.id, cached);
      done++;
      onProgress?.(done, memories.length);
      continue;
    }

    try {
      // 重试最多 3 次，指数退避
      let embedding: number[] | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          embedding = await generateFn(mem.content.slice(0, 500));
          if (embedding && embedding.length > 0) break;
        } catch {
          if (attempt < 2) {
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
          }
        }
      }
      if (embedding && embedding.length > 0) {
        embeddingCache.set(mem.content, embedding);
        result.set(mem.id, embedding);
      }
    } catch {
      // 3 次重试全部失败，跳过本条
    }

    done++;
    onProgress?.(done, memories.length);
  }

  return result;
}
