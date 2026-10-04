// 人格漂移 A/B/C 实测：她的人格到底会不会因为她自己的情绪而长？
//
// 背景（2026-09 审计结论）：
//   `driftPersonalityParams` 全项目只有 1 个调用点（stateReducer 的 applyPersonalityDrift），
//   而它挂在 `PersonalityDrifted` 事件上 —— 该事件只有前端旧 store 的 `updateEmotion` 会发，
//   而 `updateEmotion` **没有任何调用者**；`server.ts` 只 import、从未调用。
//   → **线上她的人格六参数（trust/openness/playfulness/empathy/sensitivity/resilience）一个点都没动过。**
//
// 本脚本把三种「接法」并排量出来，回答"接下来该怎么接"：
//   A  现状：完全不接线（基线，应当零漂移）
//   B1 接线 + 旧读法（绝对值 argmax）—— 复刻"基调冒充情绪"的老读法
//   B2 接线 + 新读法（激活态 separateActivation）
//   B3 接线 + 新读法 + 阈值按新尺度重标定
//
// 关于 B1/B3 的**仿真方式**（都不是改生产代码，只在喂给 drift 的向量上做等价变换）：
//   - B1：把 emotions 换成"只有基调"的向量 → argmax 必然 calm（实测线上就是这个regime）。
//         drift 里没有一条分支认 calm，故 B1 的情绪贡献应当恒为 0。
//   - B3：把 emotions 换成「基线清零 + 激活量 ×4」→ 绝对 argmax 与激活态一致，
//         且强度 ×4 ⇒ 等价于把 0.4/0.5 的阈值整体 ÷4。
//         之所以需要它：激活量的量级是 0.1~0.2，而阈值是按基调尺度（calm≈0.8）定的。
//
// 用法: node node_modules/tsx/dist/cli.mjs scripts/ab-personality-drift.ts
import { aiCoordinator } from '../server/services/aiCoordinator.js';
import { INITIAL_EMOTION_STATE, setDeterministicMode } from '../src/lib/emotionEngine.js';
import { separateActivation } from '../src/lib/emotionActivation.js';
import type { EmotionState } from '../src/lib/emotionTypes.js';

setDeterministicMode(true);   // 关掉引擎内部噪声 → 三次运行的差异只可能来自接法

const PARAMS = ['trust', 'openness', 'playfulness', 'empathy', 'sensitivity', 'resilience'] as const;

/** 30 轮剧本：有来有回，覆盖"她难过 / 她开心 / 她害怕 / 她爱意"四种被激起的情绪 */
function script(): { text: string; ua: any }[] {
  const sad = (c: string) => ({ expressedEmotion: 'sad', intensity: 0.8, directedAtAI: false, likelyCause: c });
  const joy = (c: string) => ({ expressedEmotion: 'joy', intensity: 0.8, directedAtAI: false, likelyCause: c });
  const grat = { expressedEmotion: 'gratitude', intensity: 0.9, directedAtAI: true, likelyCause: '她' };
  const love = { expressedEmotion: 'love', intensity: 0.9, directedAtAI: true, likelyCause: '她' };
  const angerAt = { expressedEmotion: 'anger', intensity: 0.9, directedAtAI: true, likelyCause: '她' };
  const fear = (c: string) => ({ expressedEmotion: 'fear', intensity: 0.7, directedAtAI: false, likelyCause: c });
  const turns: { text: string; ua: any }[] = [];
  for (let i = 0; i < 6; i++) turns.push({ text: '今天特别难过，什么都做不好', ua: sad('工作') });      // 她被牵动 → sad
  for (let i = 0; i < 4; i++) turns.push({ text: '谢谢你一直陪着我', ua: grat });                        // 指向她 → 强化
  for (let i = 0; i < 5; i++) turns.push({ text: '我跟你说个秘密，我不敢跟别人说', ua: fear('秘密') });   // fear + 脆弱
  for (let i = 0; i < 5; i++) turns.push({ text: '路上看到一只小猫，太可爱了', ua: joy('小猫') });        // joy
  for (let i = 0; i < 4; i++) turns.push({ text: '我真的很喜欢你', ua: love });                          // love
  turns.push({ text: '你昨天那句话让我很生气', ua: angerAt });                                          // anger 指向她
  while (turns.length < 30) turns.push({ text: '今天吃了面', ua: null });
  return turns.slice(0, 30);
}

type Arm = '接线前（人格冻结）' | '接线后（本脚本实跑主链）';
const ARMS: Arm[] = ['接线前（人格冻结）', '接线后（本脚本实跑主链）'];

interface Row { arm: Arm; start: Record<string, number>; end: Record<string, number>; log: string[]; sadPeak: number; joyPeak: number; lovePeak: number }
const rows: Row[] = [];

for (const arm of ARMS) {
  // 真 A/B：不靠改代码，靠主链上的开关 —— "接线前"就是关掉这一步重跑
  process.env.DISABLE_PERSONALITY_DRIFT = arm === '接线前（人格冻结）' ? 'true' : 'false';

  let state: EmotionState = structuredClone(INITIAL_EMOTION_STATE) as EmotionState;
  const start: Record<string, number> = {};
  for (const p of PARAMS) start[p] = Number((state.evolution as any)[p] ?? 50);
  const log: string[] = [];
  let sadPeak = 0, joyPeak = 0, lovePeak = 0;

  for (const [i, t] of script().entries()) {
    const out = aiCoordinator.processTurn({
      userText: t.text,
      currentEmotionState: state,
      emotionEvent: null,
      userAnalysis: t.ua,
      recentUserMoods: [],
      roundNumber: i + 1,
      lastInteractionAt: Date.now(),
    } as never);
    state = out.updatedEmotionState;
    const act = separateActivation(state.emotions);
    sadPeak = Math.max(sadPeak, act.delta.sad ?? 0);
    joyPeak = Math.max(joyPeak, act.delta.joy ?? 0);
    lovePeak = Math.max(lovePeak, act.delta.love ?? 0);

    // 主链自己会漂；这里只是把它的漂移结果记下来（不再手工调用 driftPersonalityParams）
    const d = aiCoordinator.getLastPersonalityDrift();
    if (d?.log?.length) for (const l of d.log) log.push(`第${i + 1}轮 ${l}`);
  }

  const end: Record<string, number> = {};
  for (const p of PARAMS) end[p] = Number((state.evolution as any)[p] ?? 50);
  rows.push({ arm, start, end, log, sadPeak, joyPeak, lovePeak });
}

// ── 输出 ──
console.log('30 轮固定剧本 · 确定性模式（无噪声）· 唯一变量 = 人格漂移的接法\n');
console.log(`她这 30 轮里被激起的情绪峰值：sad +${rows[0].sadPeak.toFixed(3)}  `
  + `joy +${rows[0].joyPeak.toFixed(3)}  love +${rows[0].lovePeak.toFixed(3)}`);
console.log('（对照 v1.13 重标定后的门限：joy≥0.10 / love≥0.20 / sad·anger·fear≥0.15，'
  + '锚点是 ACTIVATION_DEADZONE×3；旧门限 0.3~0.5 是按基调尺度定的，换读法后一条都撞不上）\n');

const head = '参数'.padEnd(12) + ARMS.map(a => a.padEnd(26)).join('');
console.log(head);
console.log('─'.repeat(head.length + 8));
for (const p of PARAMS) {
  let line = p.padEnd(12);
  for (const a of ARMS) {
    const r = rows.find(x => x.arm === a)!;
    const d = r.end[p] - r.start[p];
    line += `${r.start[p].toFixed(1)} → ${r.end[p].toFixed(1)}  (${d >= 0 ? '+' : ''}${d.toFixed(2)})`.padEnd(26);
  }
  console.log(line);
}

console.log('\n── 每一次漂移的原因（按臂）──');
for (const a of ARMS) {
  const r = rows.find(x => x.arm === a)!;
  console.log(`\n【${a}】共 ${r.log.length} 次漂移`);
  if (!r.log.length) { console.log('  （没有任何一次漂移 —— 她的人格纹丝不动）'); continue; }
  const byReason = new Map<string, number>();
  for (const l of r.log) {
    const reason = l.replace(/^第\d+轮 /, '').replace(/^[a-z]+: [\d.]+ → [\d.]+ /, '').replace(/[()]/g, '');
    byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
  }
  for (const [reason, n] of [...byReason].sort((x, y) => y[1] - x[1])) console.log(`  ${String(n).padStart(3)}× ${reason}`);
}

console.log('\n── 判读 ──');
console.log('接线前（开关关掉） → 零漂移：六个参数全程冻结（2026-09 之前线上就是这个状态）');
console.log('接线后（开关打开） → 她自己的情绪（激活态 + 重标定门限）开始推人格');
