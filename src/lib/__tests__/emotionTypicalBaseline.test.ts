// ── v1.25 常态基线（"她最近一段时间的常态"）──
//
// 为什么要有它：人设初始值离她的**运行点**很远（实测 calm 0.397 vs 基线 0.8、love .209 vs .4），
// 只按本性读，`suppressed` 会长期列着 calm/love/joy/greed —— 常驻噪声、信息量为零。
//
// ⚠️ 但实测（scripts/check-adaptive-baseline.ts）也量出了它的**代价**：
// 「每天一次、连着 20 天的低落」会让常态参照把她的 sad 学成"新的正常"，
// 第 60 轮时 sad 相对常态只剩 **+0.036**（而实际已饱和 1.0）—— **读不出她难过了**。
// 所以它**只做诊断读数，绝不进决策**；下面最后一条测试就是钉这条约定的。

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  updateTypicalEmotions, activationTypicalOf, activationOf,
  RESTING_EMOTION_BASELINE, EMOTION_TYPICAL_HALF_LIFE_H,
} from '../emotionActivation';
import { INITIAL_EMOTION_STATE, INITIAL_EMOTION_SWEET } from '../emotionTypes';
import type { EmotionState } from '../emotionTypes';

const HOUR = 3_600_000;

function state(emotions: Record<string, number> = {}): EmotionState {
  const s = structuredClone(INITIAL_EMOTION_STATE);
  Object.assign(s.emotions, emotions);
  return s;
}

describe('v1.25 常态基线', () => {
  it('冷启动从**人格本性**起算（不直接跳到当前值，第一次读数与旧行为连续）', () => {
    const s = state({ sad: 0.9 });
    updateTypicalEmotions(s, 1_000_000);
    expect(s.typicalEmotions).toEqual(RESTING_EMOTION_BASELINE);
    expect(s.typicalUpdatedAt).toBe(1_000_000);
  });

  it('按真实流逝时间做 EMA：一个半衰期走一半', () => {
    const s = state({ calm: 0.8, sad: 0.8 });   // sad 从 0 被拉到 0.8
    updateTypicalEmotions(s, 0);                 // 冷启动：typical = 本性（sad 0）
    updateTypicalEmotions(s, EMOTION_TYPICAL_HALF_LIFE_H * HOUR);
    expect(s.typicalEmotions!.sad).toBeCloseTo(0.4, 5);    // 半个半衰期 → 一半
    expect(s.typicalEmotions!.calm).toBeCloseTo(0.8, 5);   // 已在本性上 → 不动
  });

  it('时间没走 → 参照不动（同一时刻重复调用不该累积）', () => {
    const s = state({ sad: 0.8 });
    updateTypicalEmotions(s, 5000);
    const first = { ...s.typicalEmotions! };
    updateTypicalEmotions(s, 5000);
    updateTypicalEmotions(s, 5000);
    expect(s.typicalEmotions).toEqual(first);
  });

  it('冷启动优先用**状态自带**的人设基线（sweet 的 love .4 是"平时"，不是"被激起"）', () => {
    const sweet = structuredClone(INITIAL_EMOTION_SWEET);
    updateTypicalEmotions(sweet, 0);
    expect(sweet.typicalEmotions!.love).toBeCloseTo(0.4, 5);
    expect(activationTypicalOf(sweet).resting).toBe(true);
  });

  it('常态读数的 suppressed 会随参照收敛而清空（常驻噪声被消掉）', () => {
    // 她的 calm 长期停在 .5（比本性 .8 低）→ 本性读数一直报"平静被压低"
    const s = state({ calm: 0.5 });
    expect(activationOf(s).suppressed).toContain('calm');
    updateTypicalEmotions(s, 0);
    // 参照在 3 个半衰期里收敛到 .5 附近
    for (let i = 1; i <= 3; i++) updateTypicalEmotions(s, i * EMOTION_TYPICAL_HALF_LIFE_H * HOUR);
    expect(s.typicalEmotions!.calm).toBeCloseTo(0.5, 1);
    expect(activationTypicalOf(s).suppressed).not.toContain('calm');
  });

  it('真正的**变化**照样报（好消息不会被参照吃掉）', () => {
    const s = state({ joy: 0.3 });
    updateTypicalEmotions(s, 0);
    for (let i = 1; i <= 3; i++) updateTypicalEmotions(s, i * EMOTION_TYPICAL_HALF_LIFE_H * HOUR);   // 参照收敛到 .3
    s.emotions.joy = 0.9;                                                                          // 他带来好消息
    const a = activationTypicalOf(s);
    expect(a.activeEmotion).toBe('joy');
    expect(a.delta.joy).toBeCloseTo(0.6, 1);
  });

  it('NaN / 缺键不会污染（非法输入按 0 处理）', () => {
    const s = state();
    s.typicalEmotions = { sad: NaN, joy: 'x' as never };
    s.typicalUpdatedAt = 0;
    updateTypicalEmotions(s, EMOTION_TYPICAL_HALF_LIFE_H * HOUR);
    for (const v of Object.values(s.typicalEmotions!)) expect(Number.isFinite(v)).toBe(true);
  });

  it('没有常态记录时回退到人设基线（与 activationOf 同源，读数不会突然变成"相对 0"）', () => {
    const s = state({ sad: 0.4 });
    expect(activationTypicalOf(s).delta.sad).toBeCloseTo(activationOf(s).delta.sad, 9);
  });

  /**
   * ⚠️ 这条是**约定守卫**，不是普通单测：
   * 常态参照有实测的"适应器吞掉信号"风险（持续 20 天的低落会被学成常态 → 读不出难过），
   * 所以它**只能出现在展示层**（server 的 /state）与它自己的模块里，
   * **不允许被 src/lib 的任何决策模块引用**（记忆标签 / 人格漂移 / voice / 策略都属决策路径）。
   * 本项目的教训是"注释挡不住接线"，所以用测试挡。
   */
  it('约定：src/lib 下除 emotionActivation 自身外，没有任何模块引用 activationTypicalOf', () => {
    const libDir = join(__dirname, '..');
    const offenders: string[] = [];
    for (const name of readdirSync(libDir)) {
      if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
      if (name === 'emotionActivation.ts') continue;
      // emotionTypes.ts 只是**声明字段**（EmotionState.typicalEmotions 的类型），不读它、不参与决策
      if (name === 'emotionTypes.ts') continue;
      const text = readFileSync(join(libDir, name), 'utf8');
      if (text.includes('activationTypicalOf') || text.includes('typicalEmotions')) offenders.push(name);
    }
    expect(offenders, `这些决策模块引用了"最近常态"读数：${offenders.join(', ')}`).toEqual([]);
  });
});
