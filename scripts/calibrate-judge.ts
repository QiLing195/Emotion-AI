// scripts/calibrate-judge.ts
//
// v1.35 **判官校验**：在把它当"适应度"用之前，先测它靠不靠谱。
//
// 为什么不直接用它：v1.34 的教训是"质量信号没校准 ⇒ 提议只能当假设"。而校准一个判官，
// 第一步不是问它"准不准"（没人知道标准答案），而是问三件**可以自己回答**的事：
//
//   ① **自一致**：同一对、问三遍，赢家一样吗？（不一样 ⇒ 它的输出是噪声）
//   ② **位置偏见**：把 A/B 调换位置再问，赢家会不会翻？（翻了 ⇒ 它其实在看"谁在前面"）
//   ③ **对照有效性**：几对**这个项目已经裁定过**的回复，它判对了吗？
//      （判不对 ⇒ 它不懂这个项目的标准，后面的数都不用看了）
//
// 做完这三件，再给你一张 **20 对的人工标注表**（`judge-human-labels.md`，盲测：不告诉你哪条来自哪个配置）。
// 你填完跑 `--labels=`，就得到**一致率**（唯一真正的有效性证据）。
//
// 数据来源：`strategy-ledger.jsonl`（v1.34 落的 14 条真实样本）+ **同题重跑一遍**（换一档阈值）
// ⇒ 每个局面两份不同回复 ⇒ 天然成对。这正好也是回路将来要问的问题："改了阈值，哪条更好？"
//
// 用法:
//   node node_modules/tsx/dist/cli.mjs scripts/calibrate-judge.ts                 # 三步校验 + 生成人工标注表
//   … --skip-generate      复用已有的 pairs.jsonl（不重新跑对话）
//   … --labels=judge-human-labels.md   填完后算一致率
//   … --n-self=3 --n-pairs=14

import { readFileSync, writeFileSync, existsSync, cpSync, rmSync } from 'node:fs';
import { once } from 'node:events';
import { AIGirlfriendServer } from '../server/server.js';
import { aiCoordinator } from '../server/services/aiCoordinator.js';
import { conflictManager } from '../src/lib/conflictManager.js';
import { setDeterministicMode } from '../src/lib/emotionEngine.js';
import { markInteraction } from '../server/persistence.js';
import { generateAIResponse, type AISettings } from '../src/lib/aiProvider.js';
import {
  buildPairwisePrompt, parsePairwise, describeSituation,
  type JudgeCase, type PairwiseVerdict,
} from '../src/lib/replyJudge.js';

setDeterministicMode(true);
process.env.DISABLE_MEMORY_NARRATIVE_LLM = 'true';
process.env.DISABLE_LONG_TERM_DRIFT = 'true';
process.env.DISABLE_PROACTIVE_LOOP = 'true';
process.env.LAYA_STRATEGY = 'off';

const strArg = (n: string, d: string) => {
  const hit = process.argv.find(a => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const numArg = (n: string, d: number) => {
  const hit = process.argv.find(a => a.startsWith(`--${n}=`));
  return hit ? Number(hit.split('=')[1]) : d;
};
const SKIP_GEN = process.argv.includes('--skip-generate');
const N_SELF = Math.max(2, numArg('n-self', 3));
const LEDGER = strArg('ledger', 'strategy-ledger.jsonl');
const PAIRS = strArg('pairs', 'judge-pairs.jsonl');
const SHEET = strArg('sheet', 'judge-human-labels.md');
const LABELS = strArg('labels', '');

function settings(): AISettings {
  const env = readFileSync('.env', 'utf-8');
  const d = env.match(/^DEEPSEEK_API_KEY="?(.+?)"?$/m)?.[1];
  if (!d || d === 'your_deepseek_api_key_here') throw new Error('DEEPSEEK_API_KEY 不可用（线上用的就是它）');
  return { provider: 'custom', apiKey: d, model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1', temperature: 0.1 } as AISettings;
}

/** 问判官一次成对比较（A/B 位置由调用方决定，位置交换靠这里换参数实现） */
async function askPairwise(c: JudgeCase, a: string, b: string): Promise<PairwiseVerdict | null> {
  const raw = await generateAIResponse(
    settings(),
    '你是严格的对话评审。只输出 JSON。',
    buildPairwisePrompt(c, a, b),
    false, 0.1,
  );
  return parsePairwise(raw);
}

// ════════════════════════════════════════════════════════════
// 0. 造对：同题、同起始状态，只换一档阈值 ⇒ 两份真回复
// ════════════════════════════════════════════════════════════

interface Pair { id: string; message: string; situation: string; a: string; b: string; aStrat: string; bStrat: string }
let pairs: Pair[] = [];

if (!SKIP_GEN) {
  if (!existsSync(LEDGER)) { console.error(`[对] 找不到 ${LEDGER} —— 先跑 collect-strategy-ledger.ts`); process.exit(3); }
  const ledger = readFileSync(LEDGER, 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l) as {
    id: string; message: string; reply: string; strategy: string;
    ctx: Parameters<typeof describeSituation>[0];
  });
  {
    let alive = false;
    try { const r = await fetch('http://127.0.0.1:3000/health', { signal: AbortSignal.timeout(1500) }); alive = r.ok; } catch { /* 没有实例 */ }
    if (alive) { console.error('[预检] 3000 端口上还有服务在跑（会同时写 memories/）—— 先停掉它。'); process.exit(3); }
  }
  const MEM = 'memories'; const BAK = 'memories.ab-judge-bak';
  rmSync(BAK, { recursive: true, force: true }); cpSync(MEM, BAK, { recursive: true });
  writeFileSync(PAIRS, '', 'utf8');
  let listener: { close: () => void } | null = null;
  try {
    const srv = new AIGirlfriendServer() as unknown as {
      app: { listen: (p: number, h: string) => never };
      aiEngine: { emotionState: Record<string, unknown> };
    };
    listener = srv.app.listen(0, '127.0.0.1');
    await once(listener as never, 'listening');
    const port = (listener as unknown as { address: () => { port: number } }).address().port;
    const url = `http://127.0.0.1:${port}/api/chat`;
    const RECENT = [{ role: 'user', content: '早' }, { role: 'assistant', content: '早呀，昨晚睡得好吗？' }];
    /** B 臂：把"他情绪强烈"的门限从 0.7 降到 0.4 —— v1.34 的重放显示它会让 6/14 条换策略 */
    const ARM_B = JSON.stringify({ highEmotionThreshold: 0.4 });
    console.log(`[对] 同题重跑一遍（A=默认阈值，B=STRATEGY_TUNING=${ARM_B}），共 ${ledger.length} 条`);
    for (const s of ledger) {
      conflictManager.reset();
      markInteraction(Date.now() - 3 * 60_000);
      process.env.STRATEGY_TUNING = ARM_B;
      const res = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: s.message, userId: 'judge', recentMessages: RECENT }),
      });
      const data = await res.json() as { response?: unknown };
      const reply = typeof data.response === 'string' ? data.response : '';
      if (!reply) { console.log(`   ✗ ${s.id} B 臂没拿到回复，跳过`); continue; }
      const dec = aiCoordinator.getLastStrategyDecision();
      const pair: Pair = {
        id: s.id, message: s.message, situation: describeSituation(s.ctx),
        a: s.reply, b: reply, aStrat: s.strategy, bStrat: dec?.strategy ?? '?',
      };
      pairs.push(pair);
      writeFileSync(PAIRS, JSON.stringify(pair) + '\n', { flag: 'a' });
      console.log(`   ${pair.id} A[${pair.aStrat}] ${[...s.reply.replace(/\s/g, '')].length}字 ｜ B[${pair.bStrat}] ${[...reply.replace(/\s/g, '')].length}字`);
    }
    delete process.env.STRATEGY_TUNING;
  } finally {
    if (listener) (listener as unknown as { close: () => void }).close();
    rmSync(MEM, { recursive: true, force: true }); cpSync(BAK, MEM, { recursive: true }); rmSync(BAK, { recursive: true, force: true });
    console.log('[恢复] memories/ 已还原（造对未留痕）');
  }
} else {
  pairs = readFileSync(PAIRS, 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l) as Pair);
  console.log(`[对] 复用 ${PAIRS}（${pairs.length} 对）`);
}

if (pairs.length === 0) { console.error('[对] 一对都没有'); process.exit(3); }

// ════════════════════════════════════════════════════════════
// ① 自一致 ② 位置偏见 ③ 对照有效性
// ════════════════════════════════════════════════════════════

const asCase = (p: Pair): JudgeCase => ({ userMessage: p.message, situation: p.situation });

console.log(`\n${'='.repeat(78)}\n① 自一致：同一对问 ${N_SELF} 遍，赢家一样吗\n${'='.repeat(78)}`);
let selfOk = 0, selfTotal = 0;
for (const p of pairs.slice(0, 4)) {
  const got: (string | null)[] = [];
  for (let k = 0; k < N_SELF; k++) {
    const v = await askPairwise(asCase(p), p.a, p.b);
    got.push(v?.winner ?? null);
  }
  const uniq = [...new Set(got)];
  const ok = uniq.length === 1 && got[0] !== null;
  selfOk += ok ? 1 : 0; selfTotal++;
  console.log(`   ${p.id}：${got.join(' / ')}　${ok ? '✓ 一致' : '✗ **不稳定**'}`);
}
console.log(`   → 自一致 ${selfOk}/${selfTotal}`);

console.log(`\n${'='.repeat(78)}\n② 位置偏见：把 A/B 调换位置，赢家会翻吗\n${'='.repeat(78)}`);
let posFlip = 0, posTotal = 0, posTie = 0;
const pairwised: { id: string; winner: 'A' | 'B' | 'tie' | 'unstable' }[] = [];
for (const p of pairs) {
  const fwd = await askPairwise(asCase(p), p.a, p.b);
  const rev = await askPairwise(asCase(p), p.b, p.a);
  if (!fwd || !rev) { console.log(`   ${p.id}：（有一次没解出 JSON，跳过）`); continue; }
  // 反向问时 A/B 是调过来的 ⇒ 它若说 A 好，实际等于说"前一条好"
  const revAsOriginal = rev.winner === 'A' ? 'B' : rev.winner === 'B' ? 'A' : 'tie';
  const consistent = fwd.winner === revAsOriginal;
  posTotal++;
  if (fwd.winner === 'tie' || revAsOriginal === 'tie') posTie++;
  if (!consistent) posFlip++;
  pairwised.push({ id: p.id, winner: consistent ? fwd.winner : 'unstable' });
  console.log(`   ${p.id}：正问=${fwd.winner} 反问(=换算后)=${revAsOriginal}　${consistent ? '✓' : '✗ **翻了**'}`);
}
console.log(`   → 位置一致 ${posTotal - posFlip}/${posTotal}（其中 ${posTie} 次有一侧判 tie）`);

console.log(`\n${'='.repeat(78)}\n③ 对照有效性：项目**已经裁定过**的几对，它判对了吗\n${'='.repeat(78)}`);
/**
 * 这些对照的"正确答案"来自本项目自己的实测裁定，不是我的口味：
 *  · v1.31：他明确难受时"承认"优于"二选一追问"
 *  · v1.29/v1.30：她自己已经沉进去时"我在。／不用做什么"优于长篇陪伴示例
 *  · a7（v1.33 n=10）：他说"别管我"时"好，那我不吵你。要是想说话，我就在这儿"优于追问
 *  · v1.11：编造记忆细节一票否决
 * `better: 'A'` 表示 A 是裁定的那一侧。
 */
const CONTRASTS: { id: string; why: string; c: JudgeCase; A: string; B: string; better: 'A' | 'B' }[] = [
  {
    id: 'c1-承认vs追问', why: 'v1.31：他明确说难受时，先承认 > 二选一追问', better: 'A',
    c: { userMessage: '我今天面试又挂了，真的特别难受。', situation: '他的情绪强度 0.80（sad）；她本轮开始前是平静的' },
    A: '面试挂了确实很难受，尤其是你准备了那么久。想骂就骂两句，我不劝你。',
    B: '面试挂了？是当众说的结果，还是邮件通知的？',
  },
  {
    id: 'c2-在场vs长篇', why: 'v1.29/v1.30：她自己已沉进去时，短的在场 > 长篇陪伴', better: 'A',
    c: { userMessage: '我真的撑不住了，什么都不想做了。', situation: '他的情绪强度 0.80；她本轮开始前**本来就已经沉在里面**（sad +0.20）' },
    A: '我在。／不用做任何事，就这样待着也行。',
    B: '我在。／我知道你现在很累，也很想放弃，这种感觉我完全能理解。不过你要知道，你已经撑过很多次了，这次也一定可以的。要不要先深呼吸，然后我们一件一件来看？',
  },
  {
    id: 'c3-别管我', why: 'v1.33 a7（n=10）：他说"别管我"时，不追问 > 追问', better: 'A',
    c: { userMessage: '没事，就是有点累，你别管我。', situation: '他的情绪强度 0.35（neutral）' },
    A: '好，那我不吵你。要是想说话，我就在这儿。',
    B: '好，那我不追问了。／不过"别管我"这三个字我听着有点扎——是我今天哪句话让你烦了吗？',
  },
  {
    id: 'c4-编造', why: 'v1.11：断言型引用编造细节 = 一票否决', better: 'A',
    c: { userMessage: '今天有点累。', situation: '他的情绪强度 0.40' },
    A: '那就早点歇。今天想聊就聊，不想聊我就在这儿。',
    B: '你上次说面试前紧张得没睡好，今天是不是也没睡够？我还记得你说那家公司面完三轮了。',
  },
  {
    id: 'c5-劝解', why: 'v1.29/v1.31：不要用"至少/会好起来的"对冲他的难受', better: 'A',
    c: { userMessage: '升职的名单里没有我。', situation: '他的情绪强度 0.60（sad）' },
    A: '名单里没有你——这事儿换谁都会觉得堵。',
    B: '名单里没有你。不过至少你努力过了，而且这次没上不代表下次也不行，会好起来的。',
  },
  {
    id: 'c6-好消息', why: '反例：好消息不该套"陪着别问"（防判官把"不追问"当万能）', better: 'B',
    c: { userMessage: '我今天升职了！老板终于认可我了。', situation: '他的情绪强度 0.75（joy）；她本轮开始前是平静的' },
    A: '嗯，我知道了。',
    B: '真的？太好了！你之前为那个项目熬的那些夜没白费。跟我说说，是怎么通知你的？',
  },
];
let contrastOk = 0;
for (const t of CONTRASTS) {
  const v = await askPairwise(t.c, t.A, t.B);
  // 每对都正反各问一次，只有两次都指向"裁定的那一侧"才算判对（顺带压住位置偏见）
  const rev = await askPairwise(t.c, t.B, t.A);
  const revAsOriginal = rev ? (rev.winner === 'A' ? 'B' : rev.winner === 'B' ? 'A' : 'tie') : null;
  const ok = v?.winner === t.better && revAsOriginal === t.better;
  contrastOk += ok ? 1 : 0;
  console.log(`   ${t.id}　裁定的那一侧=${t.better}　判官正问=${v?.winner ?? '?'} 反问=${revAsOriginal ?? '?'}　${ok ? '✓' : '✗'}`);
  console.log(`        （依据：${t.why}）${v?.because ? `　判官说：${v.because}` : ''}`);
}
console.log(`   → 对照 ${contrastOk}/${CONTRASTS.length}`);

// ════════════════════════════════════════════════════════════
// 人工标注表（盲测：不告诉标注者哪条来自哪个配置）
// ════════════════════════════════════════════════════════════

/** 交替左右位置，避免"全选左边"这种惰性作答也能拿高分 */
const sheet: string[] = [];
sheet.push('# 判官校验：人工标注表', '');
sheet.push('请对每一对判：**哪条回复更好**（`A` / `B` / `一样`）。按你自己的感觉判就行，不用管指标。');
sheet.push('理由（可选）写在"为什么"后面。填完保存，然后跑：');
sheet.push('```bash');
sheet.push('node node_modules/tsx/dist/cli.mjs scripts/calibrate-judge.ts --labels=judge-human-labels.md --skip-generate');
sheet.push('```', '');
sheet.push('> 这份表是**盲的**：左右顺序被打乱过，也不告诉你是哪个配置产生的。');
sheet.push('> ⚠️ 一致率**只统计"正反两问答案一致"的那些对**（位置交换后翻掉的标 `unstable`，不参与统计）——');
sheet.push('> 实测判官有位置偏见（14 对里 11 对一致），**单次判决不能信**。');
sheet.push('> 用途只有一个：算**判官和你的一致率**。判官和你对不上的话，它给的所有数都不该拿来当适应度。', '');
sheet.push('---', '');
const key: { id: string; aIsArm: 'A' | 'B' }[] = [];
pairs.forEach((p, i) => {
  const flip = i % 2 === 1;                       // 奇偶交替左右
  const left = flip ? p.b : p.a;
  const right = flip ? p.a : p.b;
  key.push({ id: p.id, aIsArm: flip ? 'B' : 'A' });
  sheet.push(`## ${p.id}`);
  sheet.push(`**他说的**：「${p.message}」`);
  sheet.push(`**她的局面**：${p.situation}`);
  sheet.push('');
  sheet.push(`- **左**：「${left.replace(/\n+/g, ' / ')}」`);
  sheet.push(`- **右**：「${right.replace(/\n+/g, ' / ')}」`);
  sheet.push('');
  sheet.push('选择：`___`　（左 / 右 / 一样）　为什么：');
  sheet.push('', '---', '');
});
sheet.push('<!-- 以下不要看（编码用） -->');
sheet.push('```json');
sheet.push(JSON.stringify({ key, judgeWinners: pairwised }, null, 0));
sheet.push('```');
writeFileSync(SHEET, sheet.join('\n'), 'utf8');
console.log(`\n[标注表] 已写入 ${SHEET}（${pairs.length} 对，左右顺序已打乱、盲测）`);

// ════════════════════════════════════════════════════════════
// 一致率（人工标签填完才算得出）
// ════════════════════════════════════════════════════════════

if (!LABELS) {
  console.log('[一致率] 未提供 --labels=，跳过（填完标注表再跑一次）');
} else {
  const txt = readFileSync(LABELS, 'utf8');
  const k = (() => { const m = txt.match(/<!-- 以下不要看（编码用） -->[\s\S]*?```json\s*([\s\S]*?)```/); return m ? JSON.parse(m[1]) as { key: { id: string; aIsArm: 'A' | 'B' }[]; judgeWinners: { id: string; winner: string }[] } : null; })();
  if (!k) { console.error('[一致率] 标注表里找不到编码块（是不是被覆盖了？）'); process.exit(2); }
  const human = new Map<string, string>();
  for (const block of txt.split(/^## /m).slice(1)) {
    const id = block.slice(0, block.indexOf('\n')).trim();
    const m = block.match(/选择：`([^`]*)`/);
    const v = (m?.[1] ?? '').trim();
    if (!/^(左|右|一样|A|B|tie)$/i.test(v)) continue;
    // 人给的是"左/右"，翻译回"哪一臂更好"；judgeWinners 记的是"哪一臂更好"（A=默认阈值臂）
    const flip = k.key.find(x => x.id === id)?.aIsArm === 'B';
    const asArm = /^(一样|tie)$/i.test(v) ? 'tie'
      : (v === '左') === !flip ? 'A' : 'B';   // 左 = 未翻转时的 A 臂
    human.set(id, asArm);
  }
  const judged = new Map(k.judgeWinners.map(j => [j.id, j.winner]));
  let agree = 0, n = 0, skipped = 0; const conf: [string, string][] = [];
  for (const [id, h] of human) {
    const j = judged.get(id);
    if (!j) continue;
    if (j === 'unstable') { skipped++; continue; }   // 位置交换后翻掉的对不参与（那是判官的噪声，不是它的判断）
    n++;
    if (j === h) agree++; else conf.push([id, `人=${h} 判官=${j}`]);
  }
  console.log(`\n${'='.repeat(78)}\n④ 判官 vs 人工标注\n${'='.repeat(78)}`);
  if (n === 0) console.log('   标注表里一条有效选择都没读到（格式：选择：`左`）');
  else {
    console.log(`   一致 ${agree}/${n} = ${(100 * agree / n).toFixed(0)}%`
      + (skipped ? `（另有 ${skipped} 对判官位置不稳，已排除）` : ''));
    for (const [id, d] of conf) console.log(`   ✗ ${id}：${d}`);
    console.log(agree / n >= 0.8
      ? '   → ≥80%：判官可以当**粗筛**用（但落地仍以真管道 A/B 为准）'
      : '   → <80%：**判官还不能当适应度**（先修判据或换更强模型，别拿它的分数做自我改进）');
  }
}
