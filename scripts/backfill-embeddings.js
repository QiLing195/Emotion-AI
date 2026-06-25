// 一次性回填：为所有没有 embedding 的情景记忆生成向量嵌入
const fs = require('fs');
const path = 'memories/episodic_memory.json';

async function main() {
  const j = JSON.parse(fs.readFileSync(path, 'utf8'));
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) { console.error('缺少 DEEPSEEK_API_KEY'); process.exit(1); }

  let c = 0;
  for (const ep of j.episodes) {
    if (ep.embedding?.length) continue;
    const text = `${ep.narrativeFragment} ${(ep.tags || []).join(' ')}`;
    try {
      const res = await fetch('https://api.deepseek.com/v1/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: 'text-embedding-3-small', input: text }),
      });
      const data = await res.json();
      const emb = data.data?.[0]?.embedding;
      if (emb?.length) {
        ep.embedding = emb;
        c++;
      }
    } catch (e) { /* skip */ }
  }

  fs.writeFileSync(path, JSON.stringify(j, null, 2), 'utf-8');
  console.log(`done: ${c}/${j.episodes.length}`);
}

main();
