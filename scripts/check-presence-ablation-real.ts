// scripts/check-presence-ablation-real.ts
//
// **对真实 Prompt 做逐块对切**：回答"为什么 accompany 片段那句「我陪着你」在线上一次都没出现"。
//
// 为什么必须用真实 Prompt：离线复现整段 Prompt 做不到（大部分块是 server.ts 里的内联字面量）。
// 所以先用 `DUMP_PROMPT=<路径>` 把**真正发出去的那份** system prompt 抓下来（`server.ts` 里的调试口），
// 本脚本读它、原样回放，然后**每次只删一块**看"在场感"什么时候回来。
//
// 关键事实（从 dump 里看出来的顺序）：
//   人格底座 → … → **【当前策略：沉默陪伴】（片段在这里）** → 【回复前自检】→ 【表达要求·反机械化】
//   → 【避免重复】→ 【此刻…】（动机）
//   也就是说：片段**后面还压着 4 个块**，而动机块被刻意放在最末（注意力最高处）。
//
// 臂：
//   FULL              原样回放（应当复现线上：在场感缺失）
//   −自检/−反机械化/−避免重复/−动机/−片段   各删一块
//   −后四块            删掉片段之后的全部四块
//
// 用法:
//   $env:DUMP_PROMPT="$env:TEMP\dsh-prompt-dump.txt"; node ... scripts/ab-emotion-reply.ts --arms=B --n=3 --message="..."
//   node node_modules/tsx/dist/cli.mjs scripts/check-presence-ablation-real.ts [--n=3] [--dump=<path>]

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateAIChatResponse, type AISettings } from '../src/lib/aiProvider.js';

const arg = (name: string, dflt: number) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : dflt;
};
const N = Math.max(2, arg('n', 3));
const GROUP = process.argv.find(a => a.startsWith('--group='))?.slice('--group='.length) ?? 'all';
const DUMP = process.argv.find(a => a.startsWith('--dump='))?.slice('--dump='.length)
  ?? join(process.env.TEMP ?? '.', 'dsh-prompt-dump.txt');
const TEMP = 0.1;
const HIS = '我今天面试又挂了，感觉自己挺没用的。';
const RECENT = [
  { role: 'user' as const, content: '早' },
  { role: 'assistant' as const, content: '早呀，昨晚睡得好吗？' },
];

function settings(): AISettings {
  const env = readFileSync('.env', 'utf-8');
  const d = env.match(/^DEEPSEEK_API_KEY="?(.+?)"?$/m)?.[1];
  if (!d || d === 'your_deepseek_api_key_here') throw new Error('DEEPSEEK_API_KEY 不可用（线上用的就是它）');
  return { provider: 'custom', apiKey: d, model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1', temperature: TEMP } as AISettings;
}

/** 从 dump 里取**最后一份**完整 prompt（`===== ts strategy=x =====` 分隔） */
function lastPrompt(): string {
  const raw = readFileSync(DUMP, 'utf8');
  const parts = raw.split(/^=====[^\n]*=====$/m).map(s => s.trim()).filter(Boolean);
  if (!parts.length) throw new Error(`dump 里没有内容：${DUMP}`);
  return parts[parts.length - 1];
}

/** 按已知块头把 prompt 切成逻辑段（块头就是它们自己的标记） */
const MARKERS = ['【回复前自检】', '【表达要求·反机械化】', '【避免重复】', '【此刻', '【当前策略：'] as const;
function splitBlocks(prompt: string): Array<{ key: string; text: string }> {
  const idx: Array<{ key: string; at: number }> = [];
  for (const m of MARKERS) {
    const at = prompt.indexOf(m);
    if (at >= 0) idx.push({ key: m, at });
  }
  idx.sort((a, b) => a.at - b.at);
  const out: Array<{ key: string; text: string }> = [];
  if (idx.length && idx[0].at > 0) out.push({ key: '（片段之前的所有块：人格底座/记忆/persona等）', text: prompt.slice(0, idx[0].at).trim() });
  for (let i = 0; i < idx.length; i++) {
    const end = i + 1 < idx.length ? idx[i + 1].at : prompt.length;
    out.push({ key: idx[i].key, text: prompt.slice(idx[i].at, end).trim() });
  }
  return out;
}

function score(reply: string) {
  const count = (re: RegExp) => (reply.match(re) ?? []).length;
  return {
    chars: [...reply].length,
    presenceWords: count(/我在|陪着你|陪你|抱着|抱抱|我一直|不用一个人|不走|我在听/g),
    presenceAct: count(/（[^）]{1,14}）/g),
    advice: count(/别急|原因|其实|说明|应该|至少|会好起来|没关系|两码事|不是你的错|想开/g),
    probe: count(/为什么|怎么会|是不是|要不要|然后呢|后来|还是|哪一轮|哪一步/g),
  };
}
const KEYS = ['chars', 'presenceWords', 'presenceAct', 'advice', 'probe'] as const;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const full = lastPrompt();
const blocks = splitBlocks(full);
console.log(`dump：${DUMP}`);
console.log(`真实 Prompt 共 ${full.length} 字，切成 ${blocks.length} 段：`);
for (const b of blocks) console.log(`   · ${b.key}（${b.text.length} 字）`);

const DROP_SETS: Array<{ id: string; label: string; drop: string[] }> = [
  { id: 'FULL', label: '原样回放（应复现线上缺失）', drop: [] },
  { id: '−自检', label: '删【回复前自检】', drop: ['【回复前自检】'] },
  { id: '−反机械化', label: '删【表达要求·反机械化】', drop: ['【表达要求·反机械化】'] },
  { id: '−避免重复', label: '删【避免重复】', drop: ['【避免重复】'] },
  { id: '−动机', label: '删【此刻…】动机块', drop: ['【此刻'] },
  { id: '−片段', label: '删【当前策略】片段本身', drop: ['【当前策略：'] },
  { id: '−后四块', label: '删片段之后的全部四块', drop: ['【回复前自检】', '【表达要求·反机械化】', '【避免重复】', '【此刻'] },
];

const st = settings();
console.log(`\n模型：${st.model}　温度 ${TEMP}（与线上一致）　每档 n=${N}\n`);

/**
 * v1.28 的"让位时给锚"是不是反而把她推向"处理那件事"？
 * 同一份 dump，只换**动机那一块**：现状（锚）/ 旧文案（你心里没有特别挂着的事）/ 整块不给。
 */
const motiveIdx = blocks.findIndex(b => b.key.startsWith('【此刻'));
const motiveBlock = motiveIdx >= 0 ? blocks[motiveIdx].text : '';
const OLD_EMPTY = [
  '【此刻】你心里没有特别挂着的事。',
  '那就安静地陪着：可以只回应他、可以只给一个动作或一句很短的话。',
  '不要为了维持对话而泛问（"今天怎么样""在干嘛""忙不忙"这类空话一律不要）。',
].join('\n');
const MOTIVE_ARMS: Array<{ id: string; label: string; replace: string | null }> = motiveIdx < 0 ? [] : [
  { id: 'M-锚(现状)', label: '动机块 = 让位锚（v1.28 现状）', replace: motiveBlock },
  { id: 'M-空文案', label: '动机块 = 旧文案「你心里没有特别挂着的事」', replace: OLD_EMPTY },
  { id: 'M-无', label: '整块不给', replace: null },
];

const rows: Array<{ arm: string; reply: string }> = [];
if (GROUP === 'all' || GROUP === 'drop' || GROUP === 'full') {
for (const arm of (GROUP === 'full' ? DROP_SETS.filter(a => a.id === 'FULL') : DROP_SETS)) {
  const kept = blocks.filter(b => !arm.drop.some(d => b.key.startsWith(d))).map(b => b.text);
  const prompt = kept.join('\n\n');
  for (let i = 0; i < N; i++) {
    try {
      const messages = [...RECENT, { role: 'user' as const, content: HIS }];
      const r = await generateAIChatResponse(st, prompt, messages, false, TEMP);
      rows.push({ arm: arm.id, reply: (r.text ?? '').trim() });
    } catch (e) {
      console.error(`[${arm.id} #${i + 1}] 失败：${(e as Error).message}`);
    }
  }
  const rs = rows.filter(x => x.arm === arm.id);
  console.log(`── ${arm.id}　${arm.label}`);
  for (const r of rs) console.log(`   ${r.reply.replace(/\n+/g, ' / ')}`);
  console.log('');
}
console.log('══ 指标（均值）══\n');
console.log('档位'.padEnd(12) + KEYS.map(k => k.padStart(14)).join(''));
for (const arm of DROP_SETS) {
  const rs = rows.filter(r => r.arm === arm.id);
  if (!rs.length) continue;
  console.log(arm.id.padEnd(12) + KEYS.map(k => mean(rs.map(r => score(r.reply)[k])).toFixed(2).padStart(14)).join(''));
}
}  // end drop group

// ── 让"策略片段"真的落在末尾（代码注释的意图），看在场感能不能回来 ──
if (GROUP === 'all' || GROUP === 'reorder') {
  const snipIdx = blocks.findIndex(b => b.key.startsWith('【当前策略：'));
  const snip = snipIdx >= 0 ? blocks[snipIdx].text : '';
  const rest = blocks.filter((_, i) => i !== snipIdx).map(b => b.text);
  const REORDER_ARMS: Array<{ id: string; label: string; prompt: string }> = [
    { id: 'R1', label: '片段挪到**最末**（其余不变）', prompt: [...rest, snip].filter(Boolean).join('\n\n') },
    { id: 'R2', label: '片段挪到最末 + 删自检', prompt: [...rest.filter(t => !t.startsWith('【回复前自检】')), snip].filter(Boolean).join('\n\n') },
  ];
  console.log(`${GROUP === 'reorder' ? '' : '\n'}══ 把策略片段挪到真末尾（代码注释的意图）══\n`);
  for (const arm of REORDER_ARMS) {
    for (let i = 0; i < N; i++) {
      try {
        const messages = [...RECENT, { role: 'user' as const, content: HIS }];
        const r = await generateAIChatResponse(st, arm.prompt, messages, false, TEMP);
        rows.push({ arm: arm.id, reply: (r.text ?? '').trim() });
      } catch (e) {
        console.error(`[${arm.id} #${i + 1}] 失败：${(e as Error).message}`);
      }
    }
    console.log(`── ${arm.id}　${arm.label}`);
    for (const r of rows.filter(x => x.arm === arm.id)) console.log(`   ${r.reply.replace(/\n+/g, ' / ')}`);
    console.log('');
  }
  console.log('档位'.padEnd(12) + KEYS.map(k => k.padStart(14)).join(''));
  for (const arm of REORDER_ARMS) {
    const rs = rows.filter(r => r.arm === arm.id);
    if (!rs.length) continue;
    console.log(arm.id.padEnd(12) + KEYS.map(k => mean(rs.map(r => score(r.reply)[k])).toFixed(2).padStart(14)).join(''));
  }
}

// ── 只换动机块（锚 / 空文案 / 不给）──
if ((GROUP === 'all' || GROUP === 'motive') && MOTIVE_ARMS.length) {
  console.log('\n══ 只换「动机」那一块：锚 vs 旧空文案 vs 不给 ══\n');
  for (const arm of MOTIVE_ARMS) {
    const kept = blocks
      .map((b, i) => (i === motiveIdx ? arm.replace : b.text))
      .filter((t): t is string => Boolean(t && t.trim()));
    for (let i = 0; i < N; i++) {
      try {
        const messages = [...RECENT, { role: 'user' as const, content: HIS }];
        const r = await generateAIChatResponse(st, kept.join('\n\n'), messages, false, TEMP);
        rows.push({ arm: arm.id, reply: (r.text ?? '').trim() });
      } catch (e) {
        console.error(`[${arm.id} #${i + 1}] 失败：${(e as Error).message}`);
      }
    }
    console.log(`── ${arm.id}　${arm.label}`);
    for (const r of rows.filter(x => x.arm === arm.id)) console.log(`   ${r.reply.replace(/\n+/g, ' / ')}`);
    console.log('');
  }
  console.log('档位'.padEnd(12) + KEYS.map(k => k.padStart(14)).join(''));
  for (const arm of MOTIVE_ARMS) {
    const rs = rows.filter(r => r.arm === arm.id);
    if (!rs.length) continue;
    console.log(arm.id.padEnd(12) + KEYS.map(k => mean(rs.map(r => score(r.reply)[k])).toFixed(2).padStart(14)).join(''));
  }
}
console.log('\n读法：删掉哪一块时 presenceWords 明显回升 ⇒ 那块就是"压住在场感"的元凶；');
console.log('      若 FULL 就已经有在场感 ⇒ 说明线上那 12 条为 0 另有原因（状态/多轮历史/采样），要另找。');
