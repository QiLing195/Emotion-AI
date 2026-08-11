// 一次性回填：为没有 embedding 的情景记忆 + 语义记忆生成向量嵌入
const fs = require('fs');

const EPISODIC_PATH = 'memories/episodic_memory.json';
const SEMANTIC_PATH = 'memories/semantic_memory.json';
const CACHE_PATH = 'memories/semantic_embeddings.json';

async function embed(apiKey, text) {
  const res = await fetch('https://api.deepseek.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: text }),
  });
  const data = await res.json();
  return data.data?.[0]?.embedding;
}

async function main() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) { console.error('缺少 DEEPSEEK_API_KEY'); process.exit(1); }

  // ── 情景记忆回填 ──
  if (fs.existsSync(EPISODIC_PATH)) {
    const j = JSON.parse(fs.readFileSync(EPISODIC_PATH, 'utf8'));
    let c = 0;
    for (const ep of j.episodes || []) {
      if (ep.embedding?.length) continue;
      const text = `${ep.narrativeFragment || ''} ${(ep.tags || []).join(' ')}`.trim();
      if (!text) continue;
      try {
        const emb = await embed(apiKey, text);
        if (emb?.length) { ep.embedding = emb; c++; }
      } catch (e) { /* skip */ }
    }
    fs.writeFileSync(EPISODIC_PATH, JSON.stringify(j, null, 2), 'utf-8');
    console.log(`[episodic] ${c}/${j.episodes?.length || 0}`);
  }

  // ── 语义记忆回填 ──
  if (fs.existsSync(SEMANTIC_PATH)) {
    const raw = JSON.parse(fs.readFileSync(SEMANTIC_PATH, 'utf-8'));
    const phrases = Object.keys(raw);
    // 加载已有缓存
    let cache = {};
    if (fs.existsSync(CACHE_PATH)) {
      cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
    }
    let c = 0;
    for (const phrase of phrases) {
      if (cache[phrase]?.length) continue;
      try {
        const emb = await embed(apiKey, phrase);
        if (emb?.length) { cache[phrase] = emb; c++; }
      } catch (e) { /* skip */ }
    }
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf-8');
    console.log(`[semantic] ${c}/${phrases.length}`);
  }

  console.log('done.');
}

main();
