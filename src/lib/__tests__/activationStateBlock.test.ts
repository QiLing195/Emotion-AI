// ── v1.48 她的状态块：从"绝对值"改读"激发态" ──
//
// 这一段是她的状态进 Prompt 的**唯一**通路（前端把它拼进 `persona.systemPrompt`）。
// 一直用的是绝对值：`当前情绪: calm(0.80), love(0.40)…` + `主导情绪: calm。回答时自然地流露出这种情绪。`
// ⇒ 基调在竞争里永远赢，于是**每一轮**系统都对她说"你很平静，流露出平静"
//    （真管道探针实测：她激活态是「难过 +0.06」的那一轮，Prompt 里写的正是 calm）。
//
// 下面钉五件事：
//   ① 开关默认关，关着时**逐字节**与旧版相同（否则没法拿它当 A/B 的另一臂）；
//   ② 开着时不再出现"主导情绪: calm"这种结论，而是说她**此刻的偏离**；
//   ③ 底色**照样写**（爱意/贪念是关系事实，不该丢），但取的是**基线值**——
//      不能把"此刻被激起"的那一项也算进底色；
//   ④ 静息时说"不必硬演"（旧读法表达不了"她此刻没有明显情绪"）；
//   ⑤ 被压低的基调要显式说出来（`平静被压低 −0.36`）——
//      这句正是"他正在说他爸的手术、而她被说成很平静"的解药。

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildEmotionContext } from '../emotionEngine';
import { INITIAL_EMOTION_STATE } from '../emotionTypes';
import {
  ACTIVATION_DEADZONE, activationOf, activationHint, activationStateBlockEnabled, RESTING_EMOTION_BASELINE,
} from '../emotionActivation';

const KEY = 'ENABLE_ACTIVATION_STATE';
const original = process.env[KEY];
afterEach(() => {
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
});

const B = RESTING_EMOTION_BASELINE;
const mk = (over: Record<string, number> = {}) => ({
  ...structuredClone(INITIAL_EMOTION_STATE),
  emotions: { ...B, ...over },
  baselineEmotions: { ...B },
}) as never as Parameters<typeof buildEmotionContext>[0];

const LOW = mk({ sad: B.sad + 0.18 });
const REST = mk();
const JOYFUL = mk({ joy: B.joy + 0.2 });
const TWO = mk({ sad: B.sad + 0.14, fear: B.fear + 0.12 });

describe('v1.48b 末尾那条状态提示（位置才是关键）', () => {
  it('静息时不注入（与心情/反刍提示同一约定：只在确有信号时注入）', () => {
    expect(activationHint(REST)).toBe('');
    // 死区以下也不注入
    expect(activationHint(mk({ sad: B.sad + ACTIVATION_DEADZONE - 0.01 }))).toBe('');
  });

  it('有偏离时给一条短的，且明说"不用说出来"（防自述）', () => {
    const h = activationHint(LOW);
    expect(h).toContain('【我此刻的状态】');
    expect(h).toContain('难过 +0.18');
    expect(h).toContain('不用说出来');
    expect(h).toContain('该在我这一轮的话里');
    expect(h.length).toBeLessThan(120);
    expect(h).not.toContain('我很难过');
  });

  it('两股劲儿并存与被压低的底色都要照实说', () => {
    const two = activationHint(TWO);
    expect(two).toContain('难过 +0.14 与 害怕 +0.12 并存');
    const sunk = activationHint(mk({ calm: B.calm - 0.2, sad: B.sad + 0.16 }));
    expect(sunk).toContain('平静被压低了');
    expect(sunk).toContain('我此刻并不在那个底色上');
  });

  it('用的是**状态自带**的基线（人格切换后不会拿全局常数去比）', () => {
    // ① 整条基线抬高 0.2：她没有任何**正**偏离 ⇒ "静息"优先，提示为空。
    //    ⚠️ 这是刻意的（不是漏了 suppressed）：整体低于自己的底色 ≠ "被什么激起"，
    //    此刻报"静息"比硬编一个情绪安全。（`suppressed` 仍可观测，只是不进这一条提示。）
    const allHigher = Object.fromEntries(Object.entries(B).map(([k, v]) => [k, v + 0.2]));
    const stAll = {
      ...structuredClone(INITIAL_EMOTION_STATE),
      emotions: { ...B }, baselineEmotions: allHigher,
    } as never;
    expect(activationOf(stAll).suppressed.length).toBeGreaterThan(0);
    expect(activationHint(stAll)).toBe('');

    // ② 只有 calm 的底色被抬高（= 这个人格的她更平静）：她的 calm 落在自己底色之下、
    //    同时 sad 被激起 ⇒ 两条都得说（"难过 +0.18" + "平静被压低了"）。
    const stCalm = {
      ...structuredClone(INITIAL_EMOTION_STATE),
      emotions: { ...B, sad: B.sad + 0.18 },
      baselineEmotions: { ...B, calm: B.calm + 0.2 },
    } as never;
    const h = activationHint(stCalm);
    expect(h).toContain('难过 +0.18');
    expect(h).toContain('平静被压低了');
  });

  it('量具自检：低位腔那批词**不许**出现在这条提示里（否则量的是我自己的字）', () => {
    const h = activationHint(mk({ sad: B.sad + 0.18, calm: B.calm - 0.15 }));
    for (const w of ['低落', '提不起', '没劲', '闷', '堵', '打不起精神', '蔫']) {
      expect(h, `提示里出现了量具词 ${w}`).not.toContain(w);
    }
  });
});

describe('v1.48 守卫（源码扫描，不靠注释）', () => {
  it('依赖是单向的：emotionEngine → emotionActivation，反向 import 会成环', () => {
    const act = readFileSync('src/lib/emotionActivation.ts', 'utf8');
    expect(act).not.toMatch(/from '\.\/emotionEngine'/);
    const eng = readFileSync('src/lib/emotionEngine.ts', 'utf8');
    expect(eng).toMatch(/from '\.\/emotionActivation'/);
  });

  it('server 只在开关下注入那条末尾提示（不是无条件拼上去）', () => {
    const srv = readFileSync('server/server.ts', 'utf8');
    const i = srv.indexOf('activationHint(turnOutput.updatedEmotionState)');
    expect(i, 'server.ts 里没有 activationHint 调用点').toBeGreaterThan(0);
    const before = srv.slice(Math.max(0, i - 700), i);
    expect(before, '注入没有开关保护').toContain('activationStateBlockEnabled()');
  });

  it('state 层不 import 这条提示（它是 Prompt 文本，不是读数）', () => {
    for (const f of ['src/lib/lowPeriod.ts', 'src/lib/dialogueStrategy.ts', 'src/lib/motive.ts']) {
      expect(readFileSync(f, 'utf8'), f).not.toContain('activationHint');
    }
  });
});

describe('v1.48a 状态块本身（那两行怎么写）', () => {

  it('开关默认关；只认字面 true', () => {
    expect(activationStateBlockEnabled()).toBe(false);
    for (const v of ['1', 'TRUE', 'yes']) {
      process.env[KEY] = v;
      expect(activationStateBlockEnabled(), v).toBe(false);
    }
    process.env[KEY] = 'true';
    expect(activationStateBlockEnabled()).toBe(true);
  });

  it('**关着时逐字节不变**（它要能当 A/B 的另一臂）', () => {
    delete process.env[KEY];
    const off = [LOW, REST, JOYFUL, TWO].map(s => buildEmotionContext(s));
    // 旧版的两行必须原样在（英文键 + 绝对值 + 主导情绪）
    expect(off[0]).toContain('当前情绪: calm(0.80)');
    expect(off[0]).toContain('主导情绪: calm。回答时自然地流露出这种情绪。');
    expect(off[0]).not.toContain('此刻被激起');
    expect(off[0]).not.toContain('此刻状态');
    // 与"把开关设成别的值"一致（只认 true）
    process.env[KEY] = 'false';
    expect(buildEmotionContext(LOW)).toBe(off[0]);
  });

  it('开着时：主导情绪不再恒为"平静"，而是她此刻的偏离', () => {
    process.env[KEY] = 'true';
    const s = buildEmotionContext(LOW);
    expect(s).not.toContain('主导情绪: calm');
    expect(s).not.toContain('回答时自然地流露出这种情绪');
    expect(s).toContain('此刻被激起: 难过 +0.18');
    expect(s).toContain('此刻状态: 难过');
    // 防自述：不许写成"要宣布的心情"
    expect(s).toContain('别把它当成一个标签念出来');
    expect(s).not.toContain('我很难过');
  });

  it('底色照样写，但取**基线值**（不许把此刻被激起的那项算进底色）', () => {
    process.env[KEY] = 'true';
    const s = buildEmotionContext(LOW);
    const baseLine = s.split('。').find(x => x.includes('底色:'))!;
    expect(baseLine, s).toBeTruthy();
    expect(baseLine).toContain('平静 0.80');
    expect(baseLine).not.toContain('难过');       // 难过 +0.18 是她此刻的状态，不是底色
    expect(baseLine).not.toContain('sad');
    // 但英文键那行（旧读法）也不该再出现
    expect(s).not.toContain('calm(0.80)');
  });

  it('静息时明确说"不必硬演"（旧读法表达不了这件事）', () => {
    process.env[KEY] = 'true';
    const s = buildEmotionContext(REST);
    expect(s).toContain('没有明显偏离底色');
    expect(s).toContain('此刻状态: 静息');
    expect(s).toContain('不必硬演');
    expect(s).not.toContain('主导情绪');
  });

  it('两股劲儿并存时照实说（不该替她挑一个来演）', () => {
    process.env[KEY] = 'true';
    const s = buildEmotionContext(TWO);
    expect(s).toContain('难过 +0.14');
    expect(s).toContain('害怕 +0.12');
    expect(s).toContain('两股劲儿并存');
    expect(s).toContain('不必挑一个来演');
  });

  it('被压低的基调要显式说出来（这是"她并不平静"的唯一表达方式）', () => {
    process.env[KEY] = 'true';
    // calm 被压到 0.60（低于基线 0.80 超过死区），同时 sad 被激起
    const sunk = mk({ calm: B.calm - 0.2, sad: B.sad + 0.16 });
    const s = buildEmotionContext(sunk);
    expect(s).toContain('平静被压低');
    expect(s).toContain('你此刻并不在这个底色上');
    expect(activationOf(sunk).suppressed).toContain('calm');
  });

  it('死区以下不动：刚过死区才算被激起（与读数层同一个门限）', () => {
    process.env[KEY] = 'true';
    const below = mk({ sad: B.sad + ACTIVATION_DEADZONE - 0.01 });
    const above = mk({ sad: B.sad + ACTIVATION_DEADZONE + 0.01 });
    expect(buildEmotionContext(below)).toContain('此刻状态: 静息');
    expect(buildEmotionContext(above)).toContain('此刻被激起: 难过');
    expect(activationOf(below).resting).toBe(true);
    expect(activationOf(above).resting).toBe(false);
  });

  it('关系层的叙事块两臂都在（它们本来就不是"她的状态"，不该被这次改动碰掉）', () => {
    // ⚠️ 用开心那份：复合情绪叙事（"内心充满温暖和安宁"）只在强度够时才出，
    //    低落/静息时两臂本来都没有它 —— 拿它当"两臂都该有"的证据会是个假失败
    const off = buildEmotionContext(JOYFUL);
    process.env[KEY] = 'true';
    const on = buildEmotionContext(JOYFUL);
    for (const s of [off, on]) {
      expect(s).toContain('能量水平');
      expect(s).toContain('你们还在互相熟悉的阶段');
      expect(s).toContain('内心充满温暖和安宁');
    }
  });
});
