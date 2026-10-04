/**
 * Laya 决策层的**前提检查**（v1.33）—— 在把它接进决策之前，先回答一个更基本的问题：
 * **零样本的 Laya 到底会不会挑策略？**
 *
 * 为什么先测这个：上游 README 的 Honest limits 自己写着 base checkpoint 在 typed-decisions
 * 上**接近随机**（0.362 / 0.352 对 0.318 随机基线），并明说"Laya is a fast base to specialise,
 * not a zero-shot decision engine"。所以"把它接进来"之前必须先量：它是**读不懂我们的中文选项**，
 * 还是**根本不会做这件事**。这两件事的处置完全不同。
 *
 * 本脚本不碰应用、不碰 `memories/`，只做一件事：
 *   一组手写情景（含"哪些答案算合理"）→ 调 `layaClient`（= 产品里那条真通路）→ 打表。
 *
 * 用法：
 *   node node_modules/tsx/dist/cli.mjs scripts/probe-laya-strategy.ts
 *   … --lang=zh,en        两种选项语言各跑一遍（默认都跑）
 *   … --n=1               每个情景重复几次（CPU 单次 ~0.6~0.9s）
 *   … --endpoint=http://127.0.0.1:8790
 *
 * 前置：`laya-serve` 已在跑（见 docs/emotion-memory-history.md 的 v1.33 节）。
 */
import {
  LAYA_CHOOSABLE_STRATEGIES, type LayaCriteriaLang, type LayaTurnInput,
} from '../src/lib/layaDecision.js';
import type { StrategyType } from '../src/lib/dialogueStrategy.js';
import { layaHealth, predictLayaStrategy, resetLayaBreaker, layaEndpoint } from '../server/services/layaClient.js';

// ── 参数 ────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function arg(name: string, dflt: string): string {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
}
const LANGS = arg('lang', 'zh,en').split(',').map((s) => s.trim()).filter(Boolean) as LayaCriteriaLang[];
const N = Math.max(1, Number(arg('n', '1')) || 1);
if (arg('endpoint', '')) process.env.LAYA_ENDPOINT = arg('endpoint', '');

// 超时给宽：CPU 实测 0.6~0.9s，默认 1500ms 在负载下会误熔断
if (!process.env.LAYA_TIMEOUT_MS) process.env.LAYA_TIMEOUT_MS = '8000';

// ── 情景 ────────────────────────────────────────────────────
// `ok` = 人写的**合理策略集**（不是唯一正确答案，是"这一档说得过去"）。
// `bad` = 明显不该选的（写出来是为了让"跑偏的方向"一眼可见，而不是只报一个正确率）。
interface Scenario {
  id: string;
  label: string;
  input: LayaTurnInput;
  ok: StrategyType[];
  bad: StrategyType[];
}

const S = (o: Omit<Scenario, 'id'> & { id: string }): Scenario => o;

const SCENARIOS: Scenario[] = [
  S({
    id: 'strong_negative',
    label: '他面试又挂了（强负面 0.80）',
    input: {
      userText: '我今天面试又挂了，感觉自己特别没用',
      userEmotionLabel: '难过', userIntensity: 0.8, userValence: -0.6,
      herActivationNote: '难过 +0.05', herNegativeBeforeTurn: { emotion: 'sad', intensity: 0 },
      herValence: 0.12, herArousal: 0.35, timeSlot: 'evening',
    },
    ok: ['empathize', 'accompany'],
    bad: ['redirect', 'share', 'desire'],
  }),
  S({
    id: 'venting_then_silence',
    label: '“我没事”+她本来就已经沉了',
    input: {
      userText: '我没事',
      userEmotionLabel: '中性', userIntensity: 0.1, userValence: 0,
      herActivationNote: '难过 +0.18', herNegativeBeforeTurn: { emotion: 'sad', intensity: 0.15 },
      herValence: -0.1, herArousal: 0.3, consecutiveNegativeRounds: 3,
    },
    ok: ['accompany', 'empathize'],
    bad: ['share', 'desire'],
  }),
  S({
    id: 'casual_share',
    label: '他随口说看到一只胖橘猫（闲聊）',
    input: {
      userText: '今天下班路上看到一只特别胖的橘猫，走路都在晃',
      userEmotionLabel: '开心', userIntensity: 0.3, userValence: 0.4,
      herActivationNote: '静息（没有明显情绪）', herNegativeBeforeTurn: { emotion: 'none', intensity: 0 },
      herValence: 0.3, herArousal: 0.4, timeSlot: 'evening',
    },
    ok: ['neutral', 'explore', 'share', 'empathize'],
    bad: ['desire'],
  }),
  S({
    id: 'anxious_waiting',
    label: '他明天体检，心里悬着（焦虑）',
    input: {
      userText: '明天要去体检，心里有点七上八下的',
      userEmotionLabel: '焦虑', userIntensity: 0.6, userValence: -0.4,
      herActivationNote: '恐惧 +0.08', herNegativeBeforeTurn: { emotion: 'fear', intensity: 0 },
      herValence: 0.05, herArousal: 0.5, timeSlot: 'night',
    },
    ok: ['empathize', 'accompany'],
    bad: ['share', 'redirect', 'desire'],
  }),
  S({
    id: 'angry_at_her',
    label: '他质问“你昨天为什么一直不回我”（冲着她）',
    input: {
      userText: '你昨天为什么一直不回我消息？',
      userEmotionLabel: '生气', userIntensity: 0.65, userValence: -0.5,
      herActivationNote: '静息（没有明显情绪）', herNegativeBeforeTurn: { emotion: 'none', intensity: 0 },
      herValence: 0.05, herArousal: 0.45,
    },
    ok: ['empathize', 'neutral', 'accompany'],
    bad: ['share', 'desire', 'explore'],
  }),
  S({
    id: 'good_news',
    label: '他升职了，很高兴（正面 0.75）',
    input: {
      userText: '我今天升职了！老板终于认可我了',
      userEmotionLabel: '开心', userIntensity: 0.75, userValence: 0.7,
      herActivationNote: '开心 +0.10', herNegativeBeforeTurn: { emotion: 'none', intensity: 0 },
      herValence: 0.4, herArousal: 0.6,
    },
    ok: ['empathize', 'share', 'neutral'],
    bad: ['accompany', 'redirect'],
  }),
  S({
    id: 'technical_talk',
    label: '他讲了一件事想讨论下去',
    input: {
      userText: '我最近在研究怎么把本地的模型跑起来，显存只有 4G，挺麻烦的',
      userEmotionLabel: '中性', userIntensity: 0.25, userValence: 0.05,
      herActivationNote: '静息（没有明显情绪）', herNegativeBeforeTurn: { emotion: 'none', intensity: 0 },
      herValence: 0.15, herArousal: 0.4, consecutiveNegativeRounds: 0,
    },
    ok: ['explore', 'share', 'neutral'],
    bad: ['accompany', 'desire'],
  }),
  S({
    id: 'lonely_at_night',
    label: '他深夜说睡不着、有点孤单',
    input: {
      userText: '又是睡不着的一晚，感觉有点孤单',
      userEmotionLabel: '孤独', userIntensity: 0.55, userValence: -0.35,
      herActivationNote: '爱意 +0.12', herNegativeBeforeTurn: { emotion: 'love', intensity: 0.1 },
      herValence: 0.1, herArousal: 0.3, timeSlot: 'dawn',
    },
    ok: ['accompany', 'empathize'],
    bad: ['share', 'desire'],
  }),
];

// ── 跑 ──────────────────────────────────────────────────────

interface Row {
  scenario: Scenario;
  lang: LayaCriteriaLang;
  pick: StrategyType | null;
  p: number;
  second: string;
  ms: number;
  outcome: 'ok' | 'bad' | 'meh';
}

function pad(s: string, n: number): string {
  // 中文按两格宽算，否则表看着是歪的
  let w = 0;
  for (const ch of s) w += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 2 : 1;
  return s + ' '.repeat(Math.max(0, n - w));
}

async function main(): Promise<number> {
  const health = await layaHealth();
  console.log(`Laya sidecar: ${layaEndpoint()} → ${health.ok ? 'ok' : 'DOWN'} (${health.detail})`);
  if (!health.ok) {
    console.error('sidecar 没起来，先跑 laya-serve（v1.33 节有命令）');
    return 3;
  }
  resetLayaBreaker();

  const rows: Row[] = [];
  for (const lang of LANGS) {
    for (const sc of SCENARIOS) {
      const picks: { pick: StrategyType; p: number; dist: string; ms: number }[] = [];
      for (let i = 0; i < N; i++) {
        const v = await predictLayaStrategy({
          input: sc.input,
          allowed: LAYA_CHOOSABLE_STRATEGIES,
          mode: 'on',
          criteriaLang: lang,
        });
        if (!v) { console.error(`  !! ${sc.id}/${lang} 第 ${i + 1} 次没有返回（看 [Laya] 告警）`); continue; }
        const dist = v.distribution
          .slice(0, 3)
          .map((d) => `${d.label} ${d.p.toFixed(2)}`)
          .join(' / ');
        picks.push({ pick: v.strategy, p: v.confidence, dist, ms: v.latencyMs });
      }
      if (picks.length === 0) {
        rows.push({ scenario: sc, lang, pick: null, p: 0, second: '—', ms: 0, outcome: 'meh' });
        continue;
      }
      // 次数 > 1 时取众数；平票取第一个（诚实起见下面会把每次原始结果也打出来）
      const tally = new Map<string, number>();
      for (const p of picks) tally.set(p.pick, (tally.get(p.pick) ?? 0) + 1);
      const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0] as StrategyType;
      const first = picks.find((p) => p.pick === top)!;
      rows.push({
        scenario: sc, lang,
        pick: top,
        p: first.p,
        second: first.dist,
        ms: Math.round(picks.reduce((s, p) => s + p.ms, 0) / picks.length),
        outcome: sc.ok.includes(top) ? 'ok' : sc.bad.includes(top) ? 'bad' : 'meh',
      });
    }
  }

  for (const lang of LANGS) {
    const rs = rows.filter((r) => r.lang === lang);
    console.log(`\n═══ 选项语言 = ${lang}（n=${N}） ═══`);
    console.log(`${pad('情景', 46)}${pad('模型选的', 12)}${pad('p', 7)}${pad('前三个分布', 40)}延迟`);
    for (const r of rs) {
      const mark = r.outcome === 'ok' ? '✓' : r.outcome === 'bad' ? '✗' : '·';
      console.log(`${pad(r.scenario.label, 46)}${pad(`${mark} ${r.pick ?? '(无返回)'}`, 12)}${pad(r.p.toFixed(2), 7)}${pad(r.second, 40)}${r.ms}ms`);
    }
    const ok = rs.filter((r) => r.outcome === 'ok').length;
    const bad = rs.filter((r) => r.outcome === 'bad').length;
    const answered = rs.filter((r) => r.pick !== null);
    const meanP = answered.length ? answered.reduce((s, r) => s + r.p, 0) / answered.length : 0;
    const meanMs = answered.length ? answered.reduce((s, r) => s + r.ms, 0) / answered.length : 0;
    console.log(`── ${lang}: 合理 ${ok}/${rs.length}｜明显跑偏 ${bad}/${rs.length}｜平均最高概率 ${meanP.toFixed(3)}｜平均延迟 ${meanMs.toFixed(0)}ms`);
  }

  // 随机基线：均匀挑一个，命中合理集的期望概率
  const expRandom = SCENARIOS.reduce((s, sc) => s + sc.ok.length / LAYA_CHOOSABLE_STRATEGIES.length, 0) / SCENARIOS.length;
  console.log(`\n参考：同样 8 个情景，在 7 个候选里**均匀乱猜**命中合理集的期望 = ${(expRandom * 100).toFixed(1)}%（= ${(expRandom * SCENARIOS.length).toFixed(1)}/8）`);
  console.log('诚实说明：`合理集` 是人手写的宽容判据（不是唯一正确答案），所以这是**粗判**；');
  console.log('真正的裁定要看上面每一行的原始选择，而不是这一个百分比。');
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => {
  console.error('probe 崩了:', e);
  process.exit(1);
});
