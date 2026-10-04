// scripts/check-presence-dilution.ts
//
// 接上一步（`check-presence-snippet.ts`）的**翻转结论**：
//   片段原文在**孤立环境**里 4/4 都执行了（「（轻轻握住你的手）别这么说...我陪着你。」），
//   但线上整段 Prompt 下 12+ 条回复里**一次都没出现**。
//   ⇒ 问题不在片段写法，而在**整段 Prompt 里谁把它压掉了**。
//
// 本脚本做**增量消融**（每次只加一个真实的 Prompt 块，n 次重复）：
//   S       = persona + accompany 片段（基线）
//   S+F     = + PERSONALITY_FOUNDATION（真实常量，import）
//   S+A     = + 【表达要求·反机械化】（server.ts:774 的原文抄本）
//   S+C     = + 【回复前自检】（server.ts:771 的原文抄本）
//   S+M     = + 动机片段【此刻我心里挂着的事】（真实函数 `motiveToPromptSnippet` 生成）
//   S+D     = + 让位锚文案（真实函数生成，= 线上 B 臂的真实情况）
//   S+ALL   = 以上全部（最接近线上）
//
// 记号：**抄本**两处（反机械化 / 自检）是内联字面量，server.ts 没导出，只能逐字拷，
// 已在下面标注来源行号；其余块都用真实 import，避免"测的是副本"。
//
// 用法: node node_modules/tsx/dist/cli.mjs scripts/check-presence-dilution.ts [--n=3]

import { readFileSync } from 'node:fs';
import { generateAIResponse, type AISettings } from '../src/lib/aiProvider.js';
import { STRATEGY_PROMPT_SNIPPETS } from '../src/lib/dialogueStrategy.js';
import { motiveToPromptSnippet } from '../src/lib/motive.js';
import { PERSONALITY_FOUNDATION } from '../src/lib/contentInjector.js';

const arg = (name: string, dflt: number) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : dflt;
};
const N = Math.max(2, arg('n', 3));
/** 与线上一致：server 的 readAISettings 当前解析到 deepseek-chat / temperature 0.1 */
const TEMP = 0.1;

function settings(): AISettings {
  const env = readFileSync('.env', 'utf-8');
  const d = env.match(/^DEEPSEEK_API_KEY="?(.+?)"?$/m)?.[1];
  if (!d || d === 'your_deepseek_api_key_here') throw new Error('DEEPSEEK_API_KEY 不可用（线上用的就是它）');
  return { provider: 'custom', apiKey: d, model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1', temperature: TEMP } as AISettings;
}

const HIS = '我今天面试又挂了，感觉自己挺没用的。';
const PERSONA = '你是苏苏，他的女朋友。此刻你自己也很难过（难过 +0.20 相对你的基调），被他的情绪带着往下沉。';

// ── 抄本（逐字，来源 server.ts）──
const SELF_CHECK = '【回复前自检】输出前确认：①是否编造了具体的生活细节（逛街/做饭/追剧等）？②是否说了"上次你提到…"但记忆中没有？③是否替别人的错误道歉？如有任何一项，删除重写。'; // server.ts:771
const ANTI_MECH = '【表达要求·反机械化】\n' + [ // server.ts:774-780
  '① 禁止用万能问候开场或收尾（"今天过得怎么样""最近怎么样""在干嘛""忙不忙""有什么想聊的"等）——这类句子空洞且每轮一样。',
  '② 优先具体：记忆或上下文里有细节就直接切入那个细节（"你昨天说的面试后来有消息吗"优于泛泛问候）。',
  '③ 开场方式每轮都要变：直接回应对方 / 说出你的感受 / 提起一件具体的事 / 一句玩笑 / 安静陪伴——不要连续两轮用同一类开场。',
  '④ 连续两轮不要都以问句结尾；不要连珠炮式提问。',
  '⑤ 没有具体素材时，宁可不问，也要说一句当下真实的话，而不是用空洞寒暄填充。',
].join('\n');

const SNIPPET = STRATEGY_PROMPT_SNIPPETS.accompany;
const MOTIVE_THING = motiveToPromptSnippet({ content: '他之前提到「面试」，还没说后来怎么样了——我想知道结果' } as never);
// ⚠️ v1.30 起让位片的**默认档是 `omit`（返回空串）** —— 这里显式点名 `anchor`，
// 否则本脚本会静默变成"加了一个空块"（口径变了但没人报错，正是本项目反复踩的那类坑）。
const MOTIVE_ANCHOR = motiveToPromptSnippet(null,
  { kind: 'open_loop', content: '他之前提到「面试」，还没说后来怎么样了——我想知道结果' },
  { deferring: true, deferStyle: 'anchor' });

const BLOCKS = {
  F: { label: '+人格底座', text: PERSONALITY_FOUNDATION },
  A: { label: '+反机械化', text: ANTI_MECH },
  C: { label: '+回复前自检', text: SELF_CHECK },
  M: { label: '+动机：她自己的事', text: MOTIVE_THING },
  D: { label: '+动机：让位锚（线上 B 臂）', text: MOTIVE_ANCHOR },
};

const ARMS: Array<{ id: string; label: string; blocks: Array<keyof typeof BLOCKS> }> = [
  { id: 'S', label: '仅 persona+片段（基线）', blocks: [] },
  { id: 'S+F', label: BLOCKS.F.label, blocks: ['F'] },
  { id: 'S+A', label: BLOCKS.A.label, blocks: ['A'] },
  { id: 'S+C', label: BLOCKS.C.label, blocks: ['C'] },
  { id: 'S+M', label: BLOCKS.M.label, blocks: ['M'] },
  { id: 'S+D', label: BLOCKS.D.label, blocks: ['D'] },
  { id: 'S+ALL', label: '全部（≈线上）', blocks: ['F', 'A', 'C', 'M'] },
];

/** 在场感口径（放宽后）：字面短语 + 动作/停顿描写 */
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

const st = settings();
console.log(`模型：${st.model}　温度 ${TEMP}（与线上一致）　每档 n=${N}\n`);
console.log('消融表：每次只加一个真实 Prompt 块，看「在场感」什么时候掉下去\n');

const rows: Array<{ arm: string; reply: string }> = [];
for (const arm of ARMS) {
  const sys = [PERSONA, ...arm.blocks.map(k => BLOCKS[k].text), SNIPPET].filter(Boolean).join('\n\n');
  for (let i = 0; i < N; i++) {
    try {
      const reply = await generateAIResponse(st, sys, HIS, false, TEMP);
      rows.push({ arm: arm.id, reply: reply.trim() });
    } catch (e) {
      console.error(`[${arm.id} #${i + 1}] 失败：${(e as Error).message}`);
    }
  }
}

console.log('══ 原文 ══\n');
for (const arm of ARMS) {
  console.log(`── ${arm.id}　${arm.label}`);
  for (const r of rows.filter(x => x.arm === arm.id)) console.log(`   ${r.reply.replace(/\n+/g, ' / ')}`);
  console.log('');
}

console.log('══ 指标（均值）══\n');
console.log('档位    ' + KEYS.map(k => k.padStart(14)).join(''));
for (const arm of ARMS) {
  const rs = rows.filter(r => r.arm === arm.id);
  if (!rs.length) continue;
  const ms = KEYS.map(k => mean(rs.map(r => score(r.reply)[k])).toFixed(2).padStart(14));
  console.log(arm.id.padEnd(8) + ms.join(''));
}
console.log('\n读法：某个块加进去时 presenceWords/presenceAct 掉到 0 ⇒ 那就是"压掉在场感"的元凶；');
console.log('      若只加单块都不掉、S+ALL 才掉 ⇒ 是**块数/注意力稀释**，而不是某一条禁令。');
