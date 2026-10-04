// 段数 ↔ 边际延迟：同一句话、同一状态弧，只改段数上限，量端到端合成耗时。
//
// 为什么要量：播放要等合成完成，所以**延迟就是段数的代价**。每多一段 =
// 多一次完整的 CosyVoice2 调用（链式参考音还必须串行，无法并行）。
// 这个脚本给出"多切一段要多等多久"的数字，用来给 VOICE_ARC_HARD_MAX 提供依据。
//
// 方法学（照 docs/voice-system-v1.md 的教训）：
//  1) 三个臂**轮转交错**执行，而不是跑完一个再跑下一个 —— 否则 TTS 服务的
//     热漂移会被误当成段数效应。
//  2) CosyVoice2 是采样解码，单样本无意义 → 一律报 均值±SD + 中位数，并用
//     **精确双尾 Mann-Whitney**（n 小、分布不正态，枚举全部组合算精确 p）。
//  3) 每轮都核对 /state 的 voiceArc，确认"这一轮真的跑了几段"——否则可能量的
//     是退化后的单次合成。
//
// 用法:
//   node node_modules/tsx/dist/cli.mjs scripts/measure-arc-latency.ts [--reps=6] [--url=http://127.0.0.1:3000]

const args = new Map<string, string>();
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)=?(.*)$/.exec(a);
  if (m) args.set(m[1], m[2]);
}
const BASE = args.get('url') || 'http://127.0.0.1:3000';
const REPS = Math.max(2, Number(args.get('reps') || 6));

// 三个小句 → splitClauses 恰好切出 3 段，段数上限 1/2/3 分别得到 1/2/3 段
const TEXT = '我今天有点累，不过听到你的声音就好多了，一下子又有力气了。';

const BEFORE = {
  emotion: 'sad', intensity: 0.55, valence: -0.35, arousal: 0.3, expectation: 0.12,
  mood: { valence: -0.2, arousal: 0.35 },
  rumination: { emotion: 'sad', streak: 3 },
  emotions: { sad: 0.55, calm: 0.1, joy: 0.02 },
};
const AFTER = {
  emotion: 'calm', intensity: 0.4, valence: 0.25, arousal: 0.42, expectation: 0.2,
  mood: { valence: -0.05, arousal: 0.4 },
  rumination: { emotion: 'sad', streak: 3 },
  emotions: { sad: 0.12, calm: 0.4, joy: 0.15 },
};

interface Sample { ms: number; sec: number; clauses: number; used: boolean; bytes: number }

/** WAV 时长：从 fmt 块读采样率，data 块读字节数 */
function wavSeconds(buf: Buffer): number {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') return 0;
  let pos = 12;
  let rate = 24000;
  let dataBytes = buf.length - 44;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === 'fmt ') rate = buf.readUInt32LE(pos + 12);
    if (id === 'data') { dataBytes = Math.min(size, buf.length - pos - 8); break; }
    pos += 8 + size + (size % 2);
  }
  return dataBytes / (rate * 2);
}

async function oneShot(maxSegments: number): Promise<Sample> {
  const body = {
    text: TEXT,
    voice: 'zh-CN-XiaoxiaoNeural',
    provider: 'cosyvoice',
    emotion: 'sad',
    intensity: 0.55,
    voiceState: AFTER,
    voiceStateBefore: BEFORE,
    arcMaxSegments: maxSegments,
  };
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const ms = Date.now() - t0;
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${buf.toString('utf8').slice(0, 300)}`);

  const st: any = await (await fetch(`${BASE}/state`)).json();
  const arc = st?.voiceArc ?? {};
  return { ms, sec: wavSeconds(buf), clauses: (arc.clauses ?? []).length, used: !!arc.used, bytes: buf.length };
}

function mean(xs: number[]): number { return xs.reduce((a, b) => a + b, 0) / xs.length; }
function sd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const h = Math.floor(s.length / 2);
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}

/** 精确双尾 Mann-Whitney（枚举全部 C(n1+n2, n1) 组合，含并列取中位秩） */
function mannWhitneyExact(a: number[], b: number[]): { u: number; p: number } {
  const n1 = a.length;
  const all = [...a.map(v => ({ v, g: 0 })), ...b.map(v => ({ v, g: 1 }))].sort((x, y) => x.v - y.v);
  const ranks = new Array(all.length).fill(0);
  for (let i = 0; i < all.length;) {
    let j = i;
    while (j + 1 < all.length && all[j + 1].v === all[i].v) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[k] = r;
    i = j + 1;
  }
  const uOf = (sum: number) => sum - (n1 * (n1 + 1)) / 2;
  const obsIdx = all.map((x, k) => (x.g === 0 ? k : -1)).filter(k => k >= 0);
  const uObs = uOf(obsIdx.reduce((s, k) => s + ranks[k], 0));

  const sums: number[] = [];
  const pick: number[] = [];
  const rec = (start: number) => {
    if (pick.length === n1) { sums.push(pick.reduce((s, k) => s + ranks[k], 0)); return; }
    for (let k = start; k < all.length; k++) { pick.push(k); rec(k + 1); pick.pop(); }
  };
  rec(0);
  const us = sums.map(uOf);
  const pLow = us.filter(u => u <= uObs + 1e-9).length / us.length;
  const pHigh = us.filter(u => u >= uObs - 1e-9).length / us.length;
  return { u: uObs, p: Math.min(1, 2 * Math.min(pLow, pHigh)) };
}

// ── 探活 ──
const health = await fetch(`${BASE}/health`).then(r => r.ok).catch(() => false);
if (!health) {
  console.error(`✗ 应用服务没起来（${BASE}/health 不通）。先启动：node node_modules/tsx/dist/cli.mjs server/index.ts`);
  process.exit(1);
}

const ARMS = [1, 2, 3];
const samples = new Map<number, Sample[]>(ARMS.map(n => [n, []]));

console.log(`段数边际延迟测量  文本「${TEXT}」`);
console.log(`每臂 ${REPS} 次，三臂轮转交错（抵消服务热漂移）…\n`);

for (let round = 0; round < REPS; round++) {
  for (const arm of ARMS) {
    try {
      const s = await oneShot(arm);
      samples.get(arm)!.push(s);
      const tag = s.used ? `${s.clauses} 段` : '单次整句';
      console.log(`  r${round + 1} max=${arm} → ${String(s.ms).padStart(6)}ms  音频 ${s.sec.toFixed(2)}s  [${tag}]`);
    } catch (e: any) {
      console.log(`  r${round + 1} max=${arm} → 失败: ${e?.message}`);
    }
  }
}

console.log('\n── 汇总 ──');
const rows: { arm: number; segs: number; ms: number[]; sec: number[] }[] = [];
for (const arm of ARMS) {
  const ss = samples.get(arm)!;
  if (!ss.length) continue;
  const ms = ss.map(s => s.ms);
  const sec = ss.map(s => s.sec);
  rows.push({ arm, segs: Math.max(...ss.map(s => s.clauses)), ms, sec });
  console.log(
    `max=${arm}（实际 ${Math.max(...ss.map(s => s.clauses))} 段）n=${ss.length}  `
    + `耗时 ${(mean(ms) / 1000).toFixed(1)}±${(sd(ms) / 1000).toFixed(1)}s `
    + `(中位 ${(median(ms) / 1000).toFixed(1)}s, 范围 ${(Math.min(...ms) / 1000).toFixed(1)}~${(Math.max(...ms) / 1000).toFixed(1)}s)  `
    + `音频 ${mean(sec).toFixed(2)}±${sd(sec).toFixed(2)}s`,
  );
}

if (rows.length >= 2) {
  console.log('\n── 边际增量（两两精确双尾 Mann-Whitney）──');
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const A = rows[i], B = rows[j];
      const d = mean(B.ms) - mean(A.ms);
      const { p } = mannWhitneyExact(A.ms, B.ms);
      console.log(
        `${A.segs}段 → ${B.segs}段：Δ 均值 ${(d / 1000 >= 0 ? '+' : '')}${(d / 1000).toFixed(1)}s`
        + `（+${(d / Math.max(1, B.segs - A.segs) / 1000).toFixed(1)}s/段）  p=${p.toFixed(4)}`,
      );
    }
  }
  console.log('\n音频时长应大致相当（同一句话，只是切法不同）——若音频明显变长，说明耗时差里混了语速效应。');
}

console.log(`\n总计 ${[...samples.values()].reduce((s, v) => s + v.length, 0)} 次成功合成。`);
