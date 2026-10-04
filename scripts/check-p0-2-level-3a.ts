// P0-2 Level 3-a：**真实 API pipeline** —— 生产输出链是否严格服从 Guard（不碰 provenance 注入）
//
// 链路：本地 OpenAI-compatible stub ← `settings.baseUrl`（请求体提供，L580：请求体 settings 优先）
//       → generateAIChatResponse → aiText 定稿 → guardExpression → res.json
// 断言对象是 **HTTP 响应体**（不是内部变量）——这正是"客户端到底收到了什么"。
import { createServer } from 'node:http';
import { cpSync, rmSync } from 'node:fs';
import { AIGirlfriendServer } from '../server/server.js';

process.env.DISABLE_PROACTIVE_LOOP = 'true';
process.env.DISABLE_LONG_TERM_DRIFT = 'true';
process.env.DISABLE_MEMORY_NARRATIVE_LLM = 'true';
process.env.LAYA_STRATEGY = 'off';
process.env.ENABLE_MOTIVE_ACTION_STRATEGY = 'true';   // 保持与 C-2/v1.59 同一 regime（不改它，只沿用）

const APP_PORT = 34567;
const MEM = 'memories', BAK = 'memories.p0-3a-backup';
let assertionCount = 0;
const failures: string[] = [];
function check(cond: boolean, msg: string, got?: unknown): void {
  assertionCount += 1;
  if (cond) console.log('   ✓ ' + msg);
  else { failures.push(msg); console.log('   ✗ ' + msg + ' ｜ 实际=' + JSON.stringify(got)); }
}

// ── 本地 stub（OpenAI 兼容）──
let stubText = '我小时候住在海边，所以我总想起那里。';
const stubSeen: string[] = [];
const stub = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    stubSeen.push(req.url ?? '');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'chatcmpl-stub', object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: 'stub',
      choices: [{ index: 0, message: { role: 'assistant', content: stubText }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));
  });
});
await new Promise<void>(r => stub.listen(0, '127.0.0.1', () => r()));
const stubPort = (stub.address() as { port: number }).port;
console.log(`[stub] OpenAI-compatible :${stubPort}`);

try {
  rmSync(BAK, { recursive: true, force: true });
  cpSync(MEM, BAK, { recursive: true });

  const srv = new AIGirlfriendServer();
  await srv.start(APP_PORT);
  // 等它就绪（不依赖 start() 的返回值）
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    try { ready = (await fetch(`http://127.0.0.1:${APP_PORT}/health`)).ok; } catch { await new Promise(r => setTimeout(r, 500)); }
  }
  check(ready, '[前置] 真实 app 已就绪（/health 通）', ready);
  console.log(`[app] 真实 express :${APP_PORT}`);

  const call = async (message: string) => {
    const res = await fetch(`http://127.0.0.1:${APP_PORT}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message, userId: 'p0-3a',
        recentMessages: [{ role: 'user', content: '早' }, { role: 'assistant', content: '早呀' }],
        settings: { provider: 'openai', apiKey: 'p0-stub-key', model: 'stub', baseUrl: `http://127.0.0.1:${stubPort}/v1` },
      }),
    });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };

  // ── 格 A：无 provenance ⇒ 期望 NOT_APPLICABLE（Guard 不误杀），response 逐字 = stub 文本 ──
  stubText = '我小时候住在海边，所以我总想起那里。';
  const a = await call('今天下午把阳台收拾了一下。');
  console.log(`   [A] HTTP ${a.status} ｜ response=${JSON.stringify(a.body.response)}`);
  console.log(`   [A] verdict=${a.body.provenanceVerdict} accepted=${a.body.expressionAccepted} fallback=${a.body.fallbackUsed}`);
  check(a.status === 200, '[A] HTTP 200', a.status);
  check(stubSeen.some(u => u.includes('/v1/chat/completions')), '[A] stub **真的被调用**（证明走的是生产出网缝）', stubSeen);
  check(a.body.response === stubText, '[A] **HTTP 响应体逐字等于 stub 文本**（res.json 用的是 guard 后的 aiText）', a.body.response);
  check(a.body.expressionAccepted === true, '[A] expressionAccepted = true', a.body.expressionAccepted);
  check(a.body.fallbackUsed === false, '[A] fallbackUsed = false', a.body.fallbackUsed);
  check(a.body.provenanceVerdict === 'not_applicable' || a.body.provenanceVerdict === 'ambiguous',
    '[A] 无 provenance ⇒ NOT_APPLICABLE / AMBIGUOUS（**不倒向 FAIL、不误杀**）', a.body.provenanceVerdict);
  // 修正（我上一版断言写错）：语义应是「**未拒绝 ⇒ 没有 reason**」，而不是「返回一个空字段」。
  // `JSON.stringify` 会省略值为 undefined 的键 ⇒ 该键**不应出现**在响应体里。
  check(a.body.expressionRejectedReason === undefined,
    '[A] 未拒绝 ⇒ expressionRejectedReason 为 undefined（API 语义正确）', a.body.expressionRejectedReason);
  check(!Object.prototype.hasOwnProperty.call(a.body, 'expressionRejectedReason'),
    '[A] 未拒绝时该键**不出现**在 JSON 里（保持简洁）',
    Object.keys(a.body).filter(k => /Rejected/i.test(k)));

  // ── 格 B：换成明显的 self-claim 文本，但**仍然没有 provenance** ⇒ 依旧不误杀、原文逐字 ──
  stubText = '我小时候住在海边，所以我总想起那里。这话是我自己写的。';
  const b = await call('今天下午把阳台收拾了一下。');
  console.log(`   [B] HTTP ${b.status} ｜ response=${JSON.stringify(b.body.response)}`);
  console.log(`   [B] verdict=${b.body.provenanceVerdict} accepted=${b.body.expressionAccepted} fallback=${b.body.fallbackUsed}`);
  check(b.body.response === stubText, '[B] self-claim 文本在**无 provenance** 时也逐字保留（缺 provenance ⇒ 不凭空推断归属）', b.body.response);
  check(b.body.expressionAccepted === true && b.body.fallbackUsed === false, '[B] accepted=true / fallbackUsed=false', b.body);

  console.log(`\n[stub 命中] ${stubSeen.length} 次：${stubSeen.slice(0, 3).join(' ')}`);
} finally {
  stub.close();
  rmSync(MEM, { recursive: true, force: true });
  cpSync(BAK, MEM, { recursive: true });
  rmSync(BAK, { recursive: true, force: true });
  console.log(`\nASSERTIONS: ${assertionCount - failures.length}/${assertionCount}`);
  console.log(`RESULT: ${failures.length === 0 ? 'PASS' : 'FAIL'}`);
  if (failures.length) console.log('未通过：\n  - ' + failures.join('\n  - '));
  console.log(`[恢复] ${MEM}/ 已还原`);
  process.exit(failures.length === 0 ? 0 : 1);   // 必须显式退出（app 里有定时器）
}
