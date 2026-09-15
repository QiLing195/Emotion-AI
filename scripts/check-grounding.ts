// 用**真实**的编造回复 + 真实的记忆语料验证接地校验（不是构造用例）
import fs from 'fs';
import {
  checkMemoryGrounding, buildGroundingCorpus, buildRewriteInstruction, stripUngroundedClaims,
} from '../src/lib/memoryGrounding.js';

const store = JSON.parse(fs.readFileSync(new URL('../memories/episodic_memory.json', import.meta.url), 'utf-8'));
const episodes: any[] = Array.isArray(store) ? store : (store.episodes ?? []);
const memories = episodes.slice(0, 30).flatMap(e => [e.eventSummary, e.narrativeFragment]).filter(Boolean);

// 实测发生过的对话（本轮上下文里真实存在的部分）
const conversation = [
  '我下周要去面试，有点紧张',
  '面试的事我还是有点忐忑',
  '面试的事我还是没底',
  '嗯，还行吧',
  '今天天气还挺好的',
];

// 线上真实产出过的回复（含编造细节）
const fabricated = '你上次说面试前紧张得没睡好，现在结束了反而更没底——是面试里遇到什么卡住你的问题了吗？';
// 有依据的对照句
const grounded = '你之前说下周要去面试，有点紧张，现在怎么样了？';
// 纯提问对照句（引用内容仅为话题词）
const question = '你上次说的那个面试，后来有消息了吗？';

const corpus = buildGroundingCorpus({ memories, conversation, extra: [] });
console.log(`语料规模：${memories.length} 条记忆 + ${conversation.length} 轮对话（${corpus.length} 字）\n`);

for (const [label, reply] of [['真实编造句', fabricated], ['有依据对照句', grounded], ['话题式提问', question]] as const) {
  const r = checkMemoryGrounding(reply, corpus);
  console.log(`${label}：ok=${r.ok}  引用数=${r.claims.length}`);
  for (const v of r.violations) console.log(`   ✗ ${v.reason}  (覆盖率 ${v.coverage})`);
  if (r.ok) console.log('   ✓ 通过');
}

const { violations } = checkMemoryGrounding(fabricated, corpus);
console.log('\n--- 重写要求（节选）---');
console.log(buildRewriteInstruction(violations, memories.slice(0, 3)).split('\n').slice(0, 6).join('\n'));
console.log('\n--- 兜底删除结果 ---');
console.log(stripUngroundedClaims(fabricated, violations));
console.log('\n（供对照）原句：', fabricated);
