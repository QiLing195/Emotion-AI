// ── v1.26 长周期人格漂移的**可观测接线**守卫 ──
//
// 为什么要有它：`longTermDrift` 此前是「只在漂移真的发生后才填值」的字段，
// 重启后（`_lastLongTermDrift = null`）就是 `null` ⇒ 界面上"什么都没有"。
// 而"没有"有两种完全不同的含义：
//   (a) **还没到评估点**（每 20 轮算一次）—— 正常；
//   (b) **这条通路挂了**（开关被关、抛异常、round 永远不是 20 的倍数）—— 故障。
// 界面分不出来，就只能靠临时脚本去翻 —— 这正是本项目最大的失败类别
// 「写了 + 有测试 + 从没接线」的观测版本。
//
// 所以：`/state → longTermDrift` 必须**恒定**是一个对象，并把
// 「开关 / 当前轮次 / 下次评估轮次 / 门槛 / 逐参数单次上限 / 当前人格参数 / 最近一次结果」
// 全部报出来；前端必须真的消费它。注释挡不住接线脱钩，所以用测试挡。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LONG_TERM_DRIFT_SCALE,
  LONG_TERM_DRIFT_INTERVAL_ROUNDS,
  LONG_TERM_DRIFT_MIN_EPISODES,
} from '../../src/lib/personalityEvolution';

const serverSrc = readFileSync(join(__dirname, '..', 'server.ts'), 'utf8');
const viewSrc = readFileSync(join(__dirname, '..', '..', 'src', 'views', 'SettingsView.tsx'), 'utf8');

describe('v1.26 长周期漂移可观测接线', () => {
  it('/state 的 longTermDrift 是**恒定对象**（不是「发生后才非 null」的直通字段）', () => {
    // 直通写法（会变回 null）不允许再出现
    expect(serverSrc).not.toContain('longTermDrift: this._lastLongTermDrift,');
    // 最近一次结果只能挂在 `last` 上
    expect(serverSrc).toContain('last: this._lastLongTermDrift');
  });

  it('报出「为什么现在没有值」：开关 / 轮次进度 / 下次评估点 / 门槛 / 上限 / 当前人格参数', () => {
    for (const field of ['enabled:', 'round,', 'intervalRounds:', 'minEpisodes:', 'scale:', 'nextDueRound:', 'current:']) {
      expect(serverSrc, `longTermDrift 缺字段 ${field}`).toContain(field);
    }
  });

  it('门槛与单次上限**从 lib 取**，不在 server 里抄一份常数（抄了会两处漂移且不报错）', () => {
    const importLine = serverSrc.split('\n').find(l => l.includes("from '../src/lib/personalityEvolution.js'")) ?? '';
    expect(importLine).toContain('LONG_TERM_DRIFT_INTERVAL_ROUNDS');
    expect(importLine).toContain('LONG_TERM_DRIFT_MIN_EPISODES');
    expect(importLine).toContain('LONG_TERM_DRIFT_SCALE');
  });

  it('前端真的消费它（否则又是一个"接口有、界面没有"的字段）', () => {
    expect(viewSrc).toContain('data.longTermDrift');
    expect(viewSrc).toContain('<LongTermDriftDiagnostics drift={drift} />');
  });

  it('单次位移上限**逐参数**给尺度：resilience 是 [0,1]，与 [0,100] 的参数差两个数量级', () => {
    // 这条是防"统一系数"回归的：共用系数会一次把 resilience 打爆
    expect(LONG_TERM_DRIFT_SCALE.resilience).toBeLessThan(LONG_TERM_DRIFT_SCALE.trust / 10);
    expect(LONG_TERM_DRIFT_SCALE.trust).toBe(LONG_TERM_DRIFT_SCALE.openness);
    expect(LONG_TERM_DRIFT_SCALE.trust).toBe(LONG_TERM_DRIFT_SCALE.playfulness);
    // 节奏与门槛本身也要是"慢变量"该有的量级：太勤 / 太少样本都不该学
    expect(LONG_TERM_DRIFT_INTERVAL_ROUNDS).toBeGreaterThanOrEqual(10);
    expect(LONG_TERM_DRIFT_MIN_EPISODES).toBeGreaterThanOrEqual(3);
  });
});
