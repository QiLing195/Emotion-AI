// ── v1.37 低谷期时长（read-only 建模）──
//
// 为什么先做这一层：人设裁定说"她低谷时自己给自己打气，主动性降低但不是没有"，
// 但链路里**答不出**"她沉了多久" —— 所有判定都是逐轮的（Rule 1 / 让位判定只读"本轮开始前"那一帧），
// 而"一段时间"是时长。v1.36 想碰这件事只能改单轮姿态，一碰就走样。
//
// 所以本模块先只测量。下面最后两条测试是**约定守卫**：
// ① 门槛与既有两个"她真的沉进去了"常量必须相等（防同一个意思出现三个数）；
// ② 低谷读数只许展示层读 —— src/lib 无人引用、协调器只更新不读 ⇒ 行为不可能依赖它。

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  LOW_PERIOD_SINK, LOW_PERIOD_EXIT, LOW_PERIOD_MIN_TURNS, updateLowPeriod, lowPeriodOf,
} from '../lowPeriod';
import { ACCOMPANY_WHEN_SHE_SINKS, herNegativeActivation } from '../dialogueStrategy';
import { DEFER_HER_SINK } from '../motive';
import { INITIAL_EMOTION_STATE } from '../emotionTypes';
import type { EmotionState } from '../emotionTypes';

const HOUR = 3_600_000;

function state(emotions: Record<string, number> = {}): EmotionState {
  const s = structuredClone(INITIAL_EMOTION_STATE);
  Object.assign(s.emotions, emotions);
  return s;
}

/** 沉到 `depth`（sad 的基线是 0，所以 sad 值就是负激活量） */
function sunk(depth: number): EmotionState {
  return state({ sad: depth });
}

describe('v1.37 低谷期时长', () => {
  it('门槛与既有两个"她真的沉进去了"常量相等（不许同一个意思出现三个数）', () => {
    expect(LOW_PERIOD_SINK).toBe(ACCOMPANY_WHEN_SHE_SINKS);
    expect(LOW_PERIOD_SINK).toBe(DEFER_HER_SINK);
    expect(LOW_PERIOD_EXIT).toBeLessThan(LOW_PERIOD_SINK);   // 回滞带必须存在
  });

  it('负激活的定义**借用** herNegativeActivation，不另立一套', () => {
    const s = sunk(0.31);
    updateLowPeriod(s, 0);
    expect(lowPeriodOf(s, 0).depth).toBeCloseTo(herNegativeActivation(s).intensity, 9);
  });

  it('低于门槛不开张；到达门槛开张，但 1 次落定还说不上"一段"', () => {
    const below = sunk(LOW_PERIOD_SINK - 0.01);
    updateLowPeriod(below, 0);
    expect(lowPeriodOf(below, 0).active).toBe(false);
    expect(below.lowPeriod?.since).toBeNull();

    const s = sunk(LOW_PERIOD_SINK);
    updateLowPeriod(s, 0);
    const r = lowPeriodOf(s, 0);
    expect(r.active).toBe(true);
    expect(r.turns).toBe(1);
    expect(r.established).toBe(false);
    expect(r.note).toContain('还说不上');
  });

  it('跨过轮边界才算"一段"：第 2 次落定 established', () => {
    const s = sunk(0.2);
    updateLowPeriod(s, 0);
    updateLowPeriod(s, HOUR);
    const r = lowPeriodOf(s, HOUR);
    expect(r.turns).toBe(2);
    expect(r.established).toBe(true);
    expect(r.hours).toBeCloseTo(1, 5);
  });

  it('时长按**墙钟**走、轮数按观察走（我们不看她的时候，时间照样过）', () => {
    const s = sunk(0.2);
    updateLowPeriod(s, 0);
    updateLowPeriod(s, 5 * HOUR);
    const r = lowPeriodOf(s, 30 * HOUR);
    expect(r.turns).toBe(2);
    expect(r.hours).toBeCloseTo(30, 5);
    expect(r.gapHours).toBeCloseTo(25, 5);
    expect(r.note).toContain('很久没看她');
  });

  it('施密特触发：回滞带内不结案，跌破死区才结案并留下结案记录', () => {
    const s = sunk(0.4);
    updateLowPeriod(s, 0);
    updateLowPeriod(s, HOUR);                 // peak 0.4
    Object.assign(s.emotions, { sad: 0.08 }); // 回滞带内（0.05 ≤ x < 0.12）
    updateLowPeriod(s, 2 * HOUR);
    expect(lowPeriodOf(s, 2 * HOUR).active).toBe(true);
    expect(lowPeriodOf(s, 2 * HOUR).turns).toBe(3);

    Object.assign(s.emotions, { sad: 0.04 }); // 跌破死区
    updateLowPeriod(s, 3 * HOUR);
    const r = lowPeriodOf(s, 3 * HOUR);
    expect(r.active).toBe(false);
    expect(r.hours).toBe(0);
    expect(r.lastEpisode).not.toBeNull();
    expect(r.lastEpisode!.hours).toBeCloseTo(3, 5);
    expect(r.lastEpisode!.turns).toBe(3);
    expect(r.lastEpisode!.peakDepth).toBeCloseTo(0.4, 5);
    expect(r.note).toContain('上一次低谷持续 3 小时');
  });

  it('她自己往回爬是可观测的：climbing + selfRecovery，反复往下沉则 sinking', () => {
    const s = sunk(0.5);
    updateLowPeriod(s, 0);
    Object.assign(s.emotions, { sad: 0.3 });  // 回升 0.2
    updateLowPeriod(s, HOUR);
    let r = lowPeriodOf(s, HOUR);
    expect(r.phase).toBe('climbing');
    expect(r.selfRecovery).toBeCloseTo(0.2, 5);
    expect(r.peakDepth).toBeCloseTo(0.5, 5);  // 最深的一次留着
    expect(r.note).toContain('自己往回爬');

    Object.assign(s.emotions, { sad: 0.9 });  // 又往下沉
    updateLowPeriod(s, 2 * HOUR);
    r = lowPeriodOf(s, 2 * HOUR);
    expect(r.phase).toBe('sinking');
    expect(r.selfRecovery).toBeCloseTo(0.2, 5);  // 回升量不会被抵消
    expect(r.peakDepth).toBeCloseTo(0.9, 5);

    Object.assign(s.emotions, { sad: 0.9 });  // 持平
    updateLowPeriod(s, 3 * HOUR);
    expect(lowPeriodOf(s, 3 * HOUR).phase).toBe('holding');
  });

  it('契约：它是**逐轮钩子**，同一毫秒内两次调用算两轮（不做会吞真实轮次的去重）', () => {
    const s = sunk(0.3);
    updateLowPeriod(s, 0);
    updateLowPeriod(s, 0);   // 同 ms、但语义上是下一轮落定
    expect(lowPeriodOf(s, 0).turns).toBe(2);
  });

  it('跨重启：状态经 JSON 往返后读数不变（低谷不能因为重启就当她好了）', () => {
    const s = sunk(0.25);
    updateLowPeriod(s, 0);
    updateLowPeriod(s, 2 * HOUR);
    const restored = JSON.parse(JSON.stringify(s)) as EmotionState;
    const r = lowPeriodOf(restored, 2 * HOUR);
    expect(r.active).toBe(true);
    expect(r.turns).toBe(2);
    expect(r.hours).toBeCloseTo(2, 5);
    expect(r.peakDepth).toBeCloseTo(0.25, 5);
  });

  it('沉默期（他转移话题、她情绪回中性）会结案 —— 而不是把她永久钉在低谷', () => {
    const s = sunk(0.3);
    updateLowPeriod(s, 0);
    Object.assign(s.emotions, { sad: 0, calm: 0.9 });
    updateLowPeriod(s, 12 * HOUR);
    expect(lowPeriodOf(s, 12 * HOUR).active).toBe(false);
  });

  it('从未低谷过时读数干净（active=false、无结案记录、gapHours=null）', () => {
    const s = state();
    const r = lowPeriodOf(s, 0);
    expect(r.active).toBe(false);
    expect(r.phase).toBe('none');
    expect(r.lastEpisode).toBeNull();
    expect(r.gapHours).toBeNull();
    expect(r.note).toContain('还没有记录到任何低谷');
    expect(LOW_PERIOD_MIN_TURNS).toBe(2);
  });

  /**
   * v1.43 结案理由。为什么要这个字段：v1.37 曾把"低谷靠没人理她自动结案"写成局限，
   * v1.41 探针证伪（服务端当时**根本不衰减**）；v1.43 把衰减接上服务端后它**成真** ——
   * 而"时间到了"与"她自己调过来了"在数据上长得一样，不加区分就会把前者读成后者。
   */
  it('结案理由：衰减单独把她带回死区 ⇒ closedBy=idle；她自己的动力学 ⇒ closedBy=self', () => {
    // ① 没传衰减信息（= 这一轮没施加衰减）⇒ 一律 self
    const a = sunk(0.2);
    updateLowPeriod(a, 0);
    Object.assign(a.emotions, { sad: 0.2 });
    updateLowPeriod(a, HOUR);
    Object.assign(a.emotions, { sad: 0.01 });      // 她自己的动力学（或他的话）把她带回来了
    updateLowPeriod(a, 2 * HOUR);
    const ra = lowPeriodOf(a, 2 * HOUR);
    expect(ra.active).toBe(false);
    expect(ra.lastEpisode!.closedBy).toBe('self');
    expect(ra.note).toContain('她自己的动力学');

    // ② 衰减前在死区之上、衰减后跌破死区 ⇒ idle（时间到了）
    const b = sunk(0.2);
    updateLowPeriod(b, 0);
    Object.assign(b.emotions, { sad: 0.2 });
    updateLowPeriod(b, HOUR);
    Object.assign(b.emotions, { sad: 0.02 });      // 模拟"168h 衰减把它带回基线"
    updateLowPeriod(b, 2 * HOUR, { depthBeforeDecay: 0.2 });
    const rb = lowPeriodOf(b, 2 * HOUR);
    expect(rb.active).toBe(false);
    expect(rb.lastEpisode!.closedBy).toBe('idle');
    expect(rb.note).toContain('时间衰减');
    expect(rb.note).toContain('不是她自己调的');

    // ③ 判据必须是"衰减**单独**跨过死区"：衰减前就已经在死区下方（回滞带内也不可能，
    //    但接口允许传任何值）⇒ 不算 idle，否则会把她的功劳送给时间
    const c = sunk(0.2);
    updateLowPeriod(c, 0);
    Object.assign(c.emotions, { sad: 0.2 });
    updateLowPeriod(c, HOUR);
    Object.assign(c.emotions, { sad: 0.02 });
    updateLowPeriod(c, 2 * HOUR, { depthBeforeDecay: LOW_PERIOD_EXIT - 0.01 });
    expect(lowPeriodOf(c, 2 * HOUR).lastEpisode!.closedBy).toBe('self');
  });

  it('跨重启：结案理由也随状态落盘（不许重启后把 idle 记成 self）', () => {
    const s = sunk(0.2);
    updateLowPeriod(s, 0);
    Object.assign(s.emotions, { sad: 0.2 });
    updateLowPeriod(s, HOUR);
    Object.assign(s.emotions, { sad: 0.02 });
    updateLowPeriod(s, 2 * HOUR, { depthBeforeDecay: 0.2 });
    const restored = JSON.parse(JSON.stringify(s)) as EmotionState;
    expect(lowPeriodOf(restored, 2 * HOUR).lastEpisode!.closedBy).toBe('idle');
  });

  /**
   * ⚠️ 约定守卫（同 v1.25 那条的写法）：本模块是**测量**，不是决策。
   * 低谷读数的代价与常态参照同类 —— 一旦有人拿它去改行为，"她这几天怎么了"就会
   * 悄悄变成"她这几天的语气档"，而这一层还没做过任何 A/B。本项目的教训是
   * "注释挡不住接线"，所以用测试挡。
   *
   * **v1.38 起这条约定被有据地放宽了一次**（不是悄悄绕过）：低谷读数现在**可以**进决策路径，
   * 但必须同时满足两条 —— ① 只出现在**唯一一行**里 ② 那一行必须挂着低谷片段的开关
   * （v1.42 起是**两个**开关名都要挂：`lowPeriodStanceEnabled()` 与 `lowPeriodRestraintEnabled()`，
   *  两个都默认关 ⇒ 默认行为与旧版逐字相同）。放宽的理由是它要拿真管道 A/B，
   * 扩权的同时守卫改得更硬：从"绝不读"变成"读的行必须挂着**全部**开关，且只有一行"。
   */
  it('约定：src/lib 无人引用低谷读数；协调器只在开关后面读一行', () => {
    const libDir = join(__dirname, '..');
    const offenders: string[] = [];
    for (const name of readdirSync(libDir)) {
      if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
      if (name === 'lowPeriod.ts') continue;
      const text = readFileSync(join(libDir, name), 'utf8');
      if (text.includes('lowPeriodOf') || text.includes('LOW_PERIOD_SINK')) offenders.push(name);
    }
    expect(offenders, `这些决策模块引用了低谷读数：${offenders.join(', ')}`).toEqual([]);

    const coord = readFileSync(
      join(__dirname, '..', '..', '..', 'server', 'services', 'aiCoordinator.ts'), 'utf8');
    expect(coord).toContain('updateLowPeriod');   // 每轮记一笔
    // 只数**真正调用读法**的行：排除 import（那是绑名字，不是读）与整行注释。
    const readLines = coord.split('\n').filter(l => {
      const t = l.trimStart();
      return l.includes('lowPeriodOf(') && !t.startsWith('import') && !t.startsWith('//');
    });
    expect(readLines.length, '低谷读数只允许在协调器里被调用一次').toBe(1);
    for (const l of readLines) {
      // 每一个能改动"她低谷时说什么"的开关都必须在场 —— 否则新加的片段会绕过这条约定
      for (const flag of ['lowPeriodStanceEnabled()', 'lowPeriodRestraintEnabled()']) {
        expect(l, `这一行读低谷读数，却没有挂开关 ${flag}`).toContain(flag);
      }
    }
  });
});
