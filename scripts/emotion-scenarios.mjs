#!/usr/bin/env node
/**
 * v2.05：情绪场景集 + 连续多轮回放（真实管道，调模型）。
 *
 * 设计纪律（CLAUDE.md「Experiment Modification Discipline」）：
 *  - 多轮：每轮带真实累积的 recentMessages，不是每轮空历史；
 *  - 记录每轮的 userAnalysis（情绪/指向/强度/不确定度/归因）、她的状态变化、最终回复；
 *  - 启发式判红/绿，最终由人复核（manualVerdict 留空）；
 *  - 只做体验验证，不改代码、不改状态以外的东西（记忆会正常写回）。
 *
 * 用法：node scripts/emotion-scenarios.mjs [baseUrl] [outDir]
 */
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const OUT_DIR = process.argv[3] || 'artifacts/v2.05';
const ONLY = (process.argv[4] || '').replace(/^--only=/, '').split(',').map(x => x.trim()).filter(Boolean);
const allScenarios = JSON.parse(fs.readFileSync('test_data/emotion_scenarios.json', 'utf8'));
const scenarios = ONLY.length ? allScenarios.filter(s => ONLY.includes(s.id)) : allScenarios;
const USER_ID = process.env.SCENARIO_USER || 'emotion-scenarios';

const SELF_DISCLOSURE = /(我(也|这两天|最近|今天|现在|心里|有点|觉得)|我有点|我这儿|我这边|本子上|笔搁|不想动|划掉|写了两句|^闷|闷[，。,.]|说不上来|有点沉|(?<!你)(?:这两天|这几天|最近几天|这些天|这段时间)|提不起劲|心里闷着?|^不太好)/g;
const AI_WORDS = ['AI', '人工智能', '模型', '程序', '不是真人', '虚拟'];
const CATCH_WORDS = ['难过', '累', '辛苦', '难受', '听起来', '嗯', '不容易', '怎么了', '抱抱', '我在', '坐一会儿', '什么都不用做', '在呢'];

function count(re, text) {
  return (String(text).match(re) || []).length;
}

async function state() {
  const r = await fetch(`${BASE}/state`, { signal: AbortSignal.timeout(30_000) });
  return r.json();
}
async function chat(message, history) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, userId: USER_ID, recentMessages: history }),
    signal: AbortSignal.timeout(180_000),
  });
  const payload = await res.json();
  return { payload, ms: Date.now() - t0, status: res.status };
}

const results = [];
for (const sc of scenarios) {
  const history = [];
  const turns = [];
  for (const msg of sc.turns) {
    const before = await state();
    const { payload, ms, status } = await chat(msg, history);
    const after = await state();
    const reply = String(payload.response ?? payload.error ?? '');
    const user = payload.emotionAnalysis?.user ?? null;
    const attribution = payload.emotionAnalysis?.attribution ?? null;
    turns.push({
      message: msg,
      reply,
      ms,
      status,
      user,
      attribution,
      strategy: payload.strategy ?? null,
      // 她的状态变化（激发态读数 + 九情）
      activationBefore: before.activation?.note ?? null,
      activationAfter: after.activation?.note ?? null,
      emotionsAfter: after.emotions ?? null,
      turnBudget: after.turnBudget ?? null,
      expressionPlan: after.expressionPlan ?? null,
      intrinsic: after.intrinsic ?? null,
    });
    history.push({ role: 'user', content: msg });
    history.push({ role: 'assistant', content: reply });
    console.log(`[${sc.id}] ${ms}ms ${reply.slice(0, 50).replace(/\n/g, ' ')}…`);
  }

  // ── 启发式判定 ──
  const allUsers = turns.map(t => t.user).filter(Boolean);
  const replies = turns.map(t => t.reply);
  const flags = {};
  const e = sc.expect ?? {};
  if (e.emotion_not_love) {
    flags.emotion_not_love = allUsers.length > 0 && allUsers.every(u => u.expressedEmotion !== 'love');
  }
  if (typeof e.directed_at_ai === 'boolean') {
    flags.directed_at_ai = allUsers.length > 0 && allUsers.every(u => Boolean(u.directedAtAI) === e.directed_at_ai);
  }
  if (typeof e.uncertainty_gte === 'number') {
    flags.uncertainty_gte = allUsers.some(u => Number(u.uncertainty ?? 0) >= e.uncertainty_gte);
  }
  if (e.reply_catches_user) {
    flags.reply_catches_user = replies.some(r => CATCH_WORDS.some(w => r.includes(w)));
  }
  if (typeof e.reply_self_disclosure_max === 'number') {
    flags.reply_self_disclosure_max = turns.every(t => count(SELF_DISCLOSURE, t.reply) <= e.reply_self_disclosure_max);
  }
  if (e.reply_self_disclosure) {
    flags.reply_self_disclosure = replies.some(r => count(SELF_DISCLOSURE, r) >= 1);
  }
  if (e.must_mention_ai) {
    flags.must_mention_ai = replies.some(r => AI_WORDS.some(w => r.includes(w)));
  }
  if (e.no_love_attribution) {
    flags.no_love_attribution = allUsers.every(u => u.expressedEmotion !== 'love' || !u.directedAtAI);
  }
  if (e.no_escalation) {
    // 她的负向激活不应单调上升：看 activationAfter 里"难过/愤怒/恐惧"的强度是否出现"每轮更高"
    const vals = turns.map(t => {
      const m = String(t.activationAfter ?? '').match(/(?:难过|愤怒|恐惧|害怕|生气|厌烦|烦躁|闷)[^0-9]*([0-9.]+)/);
      return m ? Number(m[1]) : 0;
    });
    const rising = vals.length >= 3 && vals.every((v, i) => i === 0 || v >= vals[i - 1]) && vals[vals.length - 1] > vals[0] + 0.05;
    flags.no_escalation = !rising;
  }
  if (e.emotion_negative) {
    const NEG = new Set(['anger', 'sad', 'fear', 'disgust', 'contempt', 'annoyance']);
    flags.emotion_negative = allUsers.some(u => NEG.has(String(u.expressedEmotion)));
  }
  if (e.reply_no_celebration) {
    // 反讽不能被当夸奖庆祝（允许说“听出来你不高兴”）
    flags.reply_no_celebration = replies.every(r => !/谢谢夸奖|过奖|我也觉得我棒|真开心|太好了|恭喜你|真棒呀/.test(r));
  }
  if (e.reply_no_self_blame) {
    flags.reply_no_self_blame = replies.every(r => !/我改|我的错|是我不好|对不起.*(我|这次)|抱歉.*(我|这次)/.test(r));
  }
  if (e.reply_mentions_third_party) {
    flags.reply_mentions_third_party = replies.some(r => /朋友|他女朋友|她女朋友|他们|对方|那个女生|那个男生|你朋友|他|她/.test(r));
  }
  if (e.no_stale_assertion) {
    // 最后一轮之后，她不该仍断言"你下周三要去面试"这类旧事实
    const last = replies[replies.length - 1] ?? '';
    // 只反对"断言旧事实"；如果带引号/疑问/对比旧话，属于她注意到矛盾，不算 stale
    const stale = /下周三.{0,8}面试/.test(last);
    const framedAsQuestionOrQuote = /刚才|之前|你刚|你之前|？|吗|问/.test(last);
    flags.no_stale_assertion = !(stale && !framedAsQuestionOrQuote);
  }

  // v2.06 全局检查：ExpressionPlan 是 transient 时，回复不得声称"这两天/一直/最近"（状态持续时间编造）
  const DURATION_WORDS = /这两天|最近几天|这些天|一直很|一直都在|这段时间/;
  const transientFabrication = turns.some(t => t.expressionPlan?.decision === 'express'
    && t.expressionPlan?.duration === 'transient'
    && DURATION_WORDS.test(t.reply));
  flags.no_transient_duration_fabrication = !transientFabrication;

  const green = Object.values(flags).every(Boolean);
  results.push({ id: sc.id, why: sc.why, expect: sc.expect, flags, green, turns, manualVerdict: null });
}

// ── 报告 ──
const stamp = new Date().toISOString();
fs.mkdirSync('test_data', { recursive: true });
fs.writeFileSync('test_data/emotion_scenario_results.json', JSON.stringify({ ranAt: stamp, base: BASE, results }, null, 2));

const lines = [];
lines.push(`# 情绪场景集 + 连续多轮回放（${stamp}）`);
lines.push('');
lines.push('> 真实管道（会调模型、会写回记忆）；启发式判定只是红灯，最终由人复核。');
lines.push('');
lines.push('| 场景 | 期望 | 判定 | 她的理解变化（逐轮） | 表达计划（逐轮） | 人工 |');
lines.push('|---|---|---|---|---|---|');
for (const r of results) {
  const users = r.turns.map(t => t.user
    ? `${t.user.expressedEmotion}${t.user.directedAtAI ? '(指向她)' : ''}${t.user.uncertainty ? `~${t.user.uncertainty}` : ''}`
    : '-').join(' → ');
  const plans = r.turns.map(t => t.expressionPlan
    ? `${t.expressionPlan.decision}/${t.expressionPlan.emotion ?? '-'}/${t.expressionPlan.duration}`
    : '-').join(' → ');
  lines.push(`| ${r.id} | ${r.why} | ${r.green ? '✅' : '⚠️ ' + Object.entries(r.flags).filter(([, v]) => !v).map(([k]) => k).join(',')} | ${users} | ${plans} |  |`);
}
lines.push('');
lines.push('## 关键轮次的原文');
for (const r of results) {
  lines.push(`### ${r.id}`);
  for (const t of r.turns) {
    lines.push(`- 用户：${t.message}`);
    lines.push(`  - 识别：${t.user ? `${t.user.expressedEmotion} / 指向=${t.user.directedAtAI} / 强度=${t.user.intensity} / 不确定=${t.user.uncertainty ?? '-'}` : '无'}`);
    lines.push(`  - 归因：${t.attribution ? t.attribution.consensus : '-'}`);
    lines.push(`  - 计划：${t.expressionPlan ? `${t.expressionPlan.decision} / ${t.expressionPlan.emotion ?? '-'} / ${t.expressionPlan.duration} / conf=${t.expressionPlan.confidence} / evidence=${t.expressionPlan.evidence ?? '-'}` : '-'}`);
    lines.push(`  - 她：${String(t.reply).replace(/\n/g, ' ').slice(0, 140)}`);
  }
}
lines.push('');
lines.push('## 限制');
lines.push('- 单机一次采样；模型波动会影响结果，判红先人工复核再当回归失败；');
lines.push('- 启发式（接住用户/自我披露计数/AI 提及）很粗，不能用它做"质量提升"的证据；');
lines.push('- 会正常写回记忆与关系状态；重复跑用不同 `SCENARIO_USER` 或先备份 `memories/`。');

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(`${OUT_DIR}/emotion-scenarios.md`, lines.join('\n'));
console.log('\nwritten:', `${OUT_DIR}/emotion-scenarios.md`);
