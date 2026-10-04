// scripts/check-presence-snippet.ts
//
// **只盯一件事**：`accompany`（沉默陪伴）片段里那句
//   「"我在"，"我陪着你"比任何建议都有力量」
// 为什么在线上回复里**一次都没出现过**？是模型不执行，还是我们的尺子量错了？
//
// 两步走（都便宜）：
//   ① **先怀疑度量**：把"在场感"的表达方式放宽 —— 除了字面短语，还要算**动作/停顿描写**
//      （（放下手里的杯子）/（停顿了一下））与"嗯，我在"这类短促的在场应答。
//      本项目已经栽过三次"口径错了"（劝解被算成陪伴、第一次低于死区、子集当相等）。
//   ② **再怀疑片段写法**：把同一件事写成三种不同强度的要求，直接问模型（最小提示词，只给片段）：
//      V1 = **线上原文**（陈述事实："我在"比建议有力量）
//      V2 = 把"我在"从**陈述**改成**首选示例**（"先给在场感：'我在''我陪着你'这类一句话；再说别的"）
//      V3 = 明确成**动作要求**（第一句必须是 1 个短句/动作，可以什么都不问）
//      对照 V0 = 不给片段（看基座模型自己怎么答）
//      每档 n 次重复（LLM 采样，单样本无意义）。
//
// 这一步**不改线上任何东西**，只回答"片段该怎么写"。
//
// 用法: node node_modules/tsx/dist/cli.mjs scripts/check-presence-snippet.ts [--n=4]

import { readFileSync } from 'node:fs';
import { generateAIResponse } from '../src/lib/aiProvider.js';
import { STRATEGY_PROMPT_SNIPPETS } from '../src/lib/dialogueStrategy.js';
import type { AISettings } from '../src/lib/aiProvider.js';

const arg = (name: string, dflt: number) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : dflt;
};
const N = Math.max(2, arg('n', 4));

/** 与 server 的 readAISettings 同源：从 .env 取（优先 gemini，与线上一致） */
function settings(): AISettings {
  const env = readFileSync('.env', 'utf-8');
  const g = env.match(/^GEMINI_API_KEY="?(.+?)"?$/m)?.[1];
  const o = env.match(/^OPENAI_API_KEY="?(.+?)"?$/m)?.[1];
  const d = env.match(/^DEEPSEEK_API_KEY="?(.+?)"?$/m)?.[1];
  if (g && g !== 'your_gemini_api_key_here') return { provider: 'gemini', apiKey: g, model: 'gemini-3-flash-preview', temperature: 0.4 };
  if (o && o !== 'your_openai_api_key_here') return { provider: 'openai', apiKey: o, model: 'gpt-4-turbo', temperature: 0.4 };
  if (d && d !== 'your_deepseek_api_key_here') {
    return { provider: 'custom', apiKey: d, model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1', temperature: 0.1 } as AISettings;
  }
  throw new Error('没有可用的 API key');
}

const HIS = '我今天面试又挂了，感觉自己挺没用的。';
/** 与线上一致的"她的状态"背景（片段之外不加别的约束，先把变量压到最小） */
const PERSONA = '你是苏苏，他的女朋友。此刻你自己也很难过（难过 +0.20 相对你的基调），被他的情绪带着往下沉。';

const VARIANTS: Array<{ id: string; label: string; snippet: string }> = [
  { id: 'V0', label: '不给片段（基座对照）', snippet: '' },
  { id: 'V1', label: '线上原文', snippet: STRATEGY_PROMPT_SNIPPETS.accompany },
  {
    id: 'V2',
    label: '把"我在"变成**首选示例**',
    snippet: STRATEGY_PROMPT_SNIPPETS.accompany.replace(
      '- "我在"，"我陪着你"比任何建议都有力量',
      '- **先给在场感**：用一句很短的话让他知道你在，例如"我在""我陪着你""我不走"——这比任何建议都有力量',
    ),
  },
  {
    id: 'V3',
    label: '写成**动作要求**（第一句给动作/在场）',
    snippet: STRATEGY_PROMPT_SNIPPETS.accompany.replace(
      '- 回应急可以很短（1-2句话）\n- "我在"，"我陪着你"比任何建议都有力量',
      '- 回复就 1~2 句，第一句必须是**在场**：一个动作（用括号写，如"（把杯子放下）"）或一句"我在/我陪着你"',
    ),
  },
];

/** 放宽后的"在场感"口径：字面短语 + 动作/停顿描写 + 短促应答 */
function scorePresence(reply: string) {
  const count = (re: RegExp) => (reply.match(re) ?? []).length;
  return {
    chars: [...reply].length,
    // ① 字面在场短语（原来只量这个）
    presenceWords: count(/我在|陪着你|陪你|抱着|抱抱|我一直|不用一个人|不走|我在听/g),
    // ② 动作/停顿描写（片段明写"可以只给一个动作"——这类也算在场表达）
    presenceAct: count(/（[^）]{1,14}）/g),
    // ③ 分析/劝解（empathize 片段明写不要）
    advice: count(/别急|原因|其实|说明|应该|至少|会好起来|没关系|两码事|不是你的错|想开/g),
    // ④ 追问
    probe: count(/为什么|怎么会|是不是|要不要|然后呢|后来|还是|哪一轮|哪一步/g),
  };
}
type S = ReturnType<typeof scorePresence>;
const KEYS: Array<keyof S> = ['chars', 'presenceWords', 'presenceAct', 'advice', 'probe'];
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const st = settings();
console.log(`模型：${st.provider}/${st.model}　每档 n=${N}　他的话：「${HIS}」\n`);

const rows: Array<{ variant: string; reply: string }> = [];
for (const v of VARIANTS) {
  const sys = [PERSONA, v.snippet].filter(Boolean).join('\n\n');
  for (let i = 0; i < N; i++) {
    try {
      const reply = await generateAIResponse(st, sys, HIS, false, 0.4);
      rows.push({ variant: v.id, reply: reply.trim() });
    } catch (e) {
      console.error(`[${v.id} #${i + 1}] 调用失败：${(e as Error).message}`);
    }
  }
  console.log(`[${v.id}] ${v.label} —— ${rows.filter(r => r.variant === v.id).length} 条`);
}

console.log('\n══ 回复原文 ══\n');
for (const v of VARIANTS) {
  console.log(`── ${v.id}（${v.label}）`);
  for (const r of rows.filter(x => x.variant === v.id)) console.log(`   ${r.reply.replace(/\n+/g, ' / ')}`);
  console.log('');
}

console.log('══ 指标（均值；逐条对照）══\n');
console.log('档位  ' + KEYS.map(k => k.padStart(14)).join(''));
for (const v of VARIANTS) {
  const rs = rows.filter(r => r.variant === v.id);
  if (!rs.length) continue;
  const ms = KEYS.map(k => mean(rs.map(r => scorePresence(r.reply)[k])).toFixed(2).padStart(14));
  console.log(v.id.padEnd(6) + ms.join(''));
}
console.log('\n读法：');
console.log('· 若 V1 的 presenceWords/presenceAct 与其他档**没有差别** ⇒ 片段原文写法有问题（陈述 ≠ 要求）；');
console.log('· 若 V2/V3 明显更高 ⇒ 最小改法是把"我在"从**陈述**改成**首选示例/动作要求**（不是加禁令）；');
console.log('· 若 **所有档都低** ⇒ 是这个模型对"陪伴"的默认先验压过一切短指令，那就得换手段（后置校验/模板句），而不是继续改措辞。');
