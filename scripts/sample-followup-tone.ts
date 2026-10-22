/**
 * v1.81 样本：她的"到点自己想起来"会说成什么样（只采集，不改代码）
 *
 * 目的：v1.80 只看了 1 条样本就担心"别忘了"式祈使口吻。本脚本用**生产同一条 Prompt 路径**
 * （buildRecallHint + buildProactivePrompt + 同 system prompt + 同 temperature）生成 8 条，
 * 再按口吻粗分类，供人工判断是否要调提示——**不根据单条样本改措辞**。
 *
 * 用法：node node_modules/tsx/dist/cli.mjs scripts/sample-followup-tone.ts
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { generateAIResponse } from '../src/lib/aiProvider.js';
import { buildProactivePrompt } from '../server/services/proactiveMessenger.js';
import { buildRecallHint } from '../server/services/herFollowups.js';
import { sanitizeProactiveMessage } from '../server/services/proactiveMessenger.js';
import type { Followup } from '../server/services/herFollowups.js';

function readSettings() {
  const dotenv = readFileSync('.env', 'utf-8');
  const geminiKey = dotenv.match(/^GEMINI_API_KEY="?(.+?)"?$/m)?.[1];
  const openaiKey = dotenv.match(/^OPENAI_API_KEY="?(.+?)"?$/m)?.[1];
  const deepseekKey = dotenv.match(/^DEEPSEEK_API_KEY="?(.+?)"?$/m)?.[1];
  if (geminiKey && geminiKey !== 'your_gemini_api_key_here') {
    return { provider: 'gemini', apiKey: geminiKey, model: 'gemini-3-flash-preview', temperature: 0.4 } as never;
  }
  if (openaiKey && openaiKey !== 'your_openai_api_key_here') {
    return { provider: 'openai', apiKey: openaiKey, model: 'gpt-4-turbo', temperature: 0.4 } as never;
  }
  if (deepseekKey && deepseekKey !== 'your_deepseek_api_key_here') {
    return { provider: 'deepseek', apiKey: deepseekKey, model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1', temperature: 0.1 } as never;
  }
  return null;
}

const SYSTEM = '你是一个有自己生活的女朋友。你想起了一件自己一直记着的事，于是主动发一条很短的消息给他。'
  + '用你自己的话、按你此刻的心情说，不要复述"我之前记下了…"这类元描述。只输出消息正文。';

const CASES: Array<{ what: string; mood: string; idle: number }> = [
  { what: '他下周三要去体检，问问结果和感受', mood: '有点沉，心里堵着', idle: 300 },
  { what: '他今天下午有一场面试，问问怎么样了', mood: '替他悬着，有点紧', idle: 240 },
  { what: '他妈妈下周过生日，问问他准备了什么', mood: '平静', idle: 420 },
  { what: '他借的书该还了，提醒他一声', mood: '懒懒的，不想动', idle: 200 },
  { what: '他说周末想去爬山，问他还去不去', mood: '有点期待', idle: 360 },
  { what: '他这周要交房租，问问他交了没有', mood: '平静', idle: 180 },
  { what: '他上次说想学吉他，问问他开始了没', mood: '心情不错', idle: 300 },
  { what: '他明天要早起赶飞机，让他早点睡', mood: '有点舍不得', idle: 260 },
];

function classify(text: string): string {
  const imperative = /别忘了|记得|要记得|提醒|别忘|一定要/.test(text);
  const question = /[？?]/.test(text);
  const sharesSelf = /我/.test(text);
  return [
    imperative ? '祈使/提醒口吻' : '分享口吻',
    question ? '带问句' : '无问句',
    sharesSelf ? '提自己' : '只说他',
  ].join(' · ');
}

async function main() {
  const settings = readSettings();
  if (!settings) {
    console.error('没有可用的 API Key，无法采样');
    process.exit(1);
  }
  const out: string[] = [];
  const counts: Record<string, number> = { imperative: 0, question: 0, shareSelf: 0, total: 0 };
  for (const c of CASES) {
    const item: Followup = {
      id: 'sample', what: c.what, dueAt: Date.now(), createdAt: Date.now(), sentAt: null, cancelled: false,
    };
    let text = '';
    try {
      const raw = await generateAIResponse(
        settings,
        SYSTEM,
        buildProactivePrompt({
          motive: { content: buildRecallHint(item) } as never,
          moodDescription: c.mood,
          minutesSinceLast: c.idle,
          relationshipStageLabel: '恋人',
          recentUserTexts: [],
        }),
        false,
        0.85,
      );
      text = sanitizeProactiveMessage(typeof raw === 'string' ? raw : '') ?? '';
    } catch (e) {
      text = `[生成失败] ${(e as Error).message}`;
    }
    const tag = classify(text);
    counts.total++;
    if (/祈使/.test(tag)) counts.imperative++;
    if (/带问句/.test(tag)) counts.question++;
    if (/提自己/.test(tag)) counts.shareSelf++;
    out.push(`| ${c.what} | ${c.mood} | ${text} | ${text.length} | ${tag} |`);
    console.log(`[${out.length}] ${text}  （${tag}）`);
  }
  const md = [
    '# v1.81 样本：到点"她自己想起来"的 8 种说法',
    '',
    `采样时间：${new Date().toISOString()}｜同一条生产 Prompt（buildRecallHint + buildProactivePrompt）｜temperature 0.85`,
    '',
    '| 她记着的这件事 | 她此刻的状态 | 她发出来的话 | 字数 | 口吻 |',
    '|---|---|---|---|---|',
    ...out,
    '',
    '## 统计（只描述这批样本，不外推）',
    '',
    `- 祈使/提醒口吻：**${counts.imperative}/${counts.total}**`,
    `- 带问句：**${counts.question}/${counts.total}**`,
    `- 提到自己：**${counts.shareSelf}/${counts.total}**`,
    '',
  ].join('\n');
  const dir = join('artifacts', 'v1.81');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'followup-tone-samples.md'), md, 'utf8');
  console.log(`\n已写入 artifacts/v1.81/followup-tone-samples.md`);
}

void main();
