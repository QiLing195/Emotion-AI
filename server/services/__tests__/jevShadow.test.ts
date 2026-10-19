import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assembleJevInput,
  buildJevPrompt,
  parseJevOutput,
  jevAgrees,
  jevEnabled,
  runJevShadow,
  jevInputDigest,
  JEV_INNER_LINE_MAX,
  JEV_DEFAULT_TIMEOUT_MS,
  type AssembleJevInputArgs,
  type JevInput,
} from '../jevShadow.js';

function baseArgs(over: Partial<AssembleJevInputArgs> = {}): AssembleJevInputArgs {
  return {
    herValence: -0.34,
    lowPeriodActive: true,
    lowPeriodTurns: 4,
    ruminationDominant: 'sad',
    ruminationStreak: 3,
    hisEmotion: 'joy',
    hisIntensity: 0.72,
    hisSummary: '他说项目通过了，松了口气',
    recent: [
      { who: 'him', emotion: 'joy' },
      { who: 'her', intent: 'share' },
    ],
    candidates: [
      { id: 'm1', kind: 'memory_echo', salience: 0.62, content: '我想起他说过的那件事' },
      { id: 'm3', kind: 'state', salience: 0.55, content: '我这两天有点提不起劲' },
      { id: 'm2', kind: 'open_loop', salience: 0.80, content: '他面试的事有消息了吗' },
    ],
    relationshipStage: 'close',
    relationshipTurns: 412,
    rulesAction: 'wait',
    rulesMotiveId: 'm3',
    rulesReasonCode: 'RULE1_HIS_STRONG_HER_SINK',
    rulesReasonText: '用户情绪强度 0.85 > 0.7，但我自己也被带进去了 —— 不再追着共情，安静陪着',
    ...over,
  };
}

function inputOf(over: Partial<AssembleJevInputArgs> = {}): JevInput {
  return assembleJevInput(baseArgs(over));
}

function validOutputJson(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    action: 'share',
    motive_id: 'm1',
    inner_line: '我也想跟他说说我的事',
    conflict: 'her_vs_his',
    reason_code: 'SHE_WANTS_TO_SHARE',
    ...over,
  });
}

describe('assembleJevInput（归一化，不做判断）', () => {
  it('夹紧数值、截断摘要、按 salience 排序并去重候选', () => {
    const input = inputOf({
      herValence: -9,
      hisIntensity: 5,
      hisSummary: 'x'.repeat(200),
      candidates: [
        { id: 'a', kind: 'state', salience: 0.2, content: '短' },
        { id: 'b', kind: 'wish', salience: 0.9, content: '高' },
        { id: 'a', kind: 'state', salience: 0.95, content: '重复 id 应被丢弃' },
      ],
    });
    expect(input.her_state.valence).toBe(-1);
    expect(input.his_turn.intensity).toBe(1);
    expect(Array.from(input.his_turn.summary).length).toBe(60);
    // 排序在前、去重在后 ⇒ 重复 id 的那条 salience 更高（0.95），先入选；
    // 之后同 id 的低分条被丢弃（保留高分那条），再收 b（0.9）。
    expect(input.candidates.map(c => c.id)).toEqual(['a', 'b']);
    expect(input.candidates[0].salience).toBeCloseTo(0.95, 5);
  });

  it('低潮未成段时 low_period 为 null；无主导情绪时 rumination 为 null', () => {
    const input = inputOf({ lowPeriodActive: false, ruminationDominant: null });
    expect(input.her_state.low_period).toBeNull();
    expect(input.her_state.rumination).toBeNull();
  });

  it('rules_default 的 motive_id 若不在候选里 ⇒ 置 null（不留悬空引用）', () => {
    const input = inputOf({ rulesMotiveId: '不存在的动机' });
    expect(input.rules_default.motive_id).toBeNull();
  });

  it('非法 rulesAction ⇒ 回落 wait；非法 reason_code ⇒ RULE_DEFAULT', () => {
    const input = inputOf({ rulesAction: 'shout' as never, rulesReasonCode: 'lowercase' });
    expect(input.rules_default.action).toBe('wait');
    expect(input.rules_default.reason_code).toBe('RULE_DEFAULT');
  });

  it('激活态只保留被激起的信号（丢掉 |delta|<0.005 的浮点噪声）', () => {
    const input = inputOf({ herActivated: { sad: 0.08, joy: -0.02, calm: 0.001 } });
    expect(input.her_state.activated.sad).toBeCloseTo(0.08, 5);
    expect(input.her_state.activated.joy).toBeCloseTo(-0.02, 5);
    expect(input.her_state.activated.calm).toBeUndefined();
  });
});

describe('buildJevPrompt', () => {
  it('包含规则决策与候选 id，并声明 inner_line 上限', () => {
    const prompt = buildJevPrompt(inputOf());
    expect(prompt).toContain('RULE1_HIS_STRONG_HER_SINK');
    expect(prompt).toContain('"rules_default"');
    expect(prompt).toContain('m1');
    expect(prompt).toContain(String(JEV_INNER_LINE_MAX));
    expect(prompt).toContain('her_vs_his');
  });
});

describe('parseJevOutput（严格校验）', () => {
  it('合法输出 ⇒ 解析成功', () => {
    const out = parseJevOutput(validOutputJson(), inputOf());
    expect(out).not.toBeNull();
    expect(out!.action).toBe('share');
    expect(out!.motive_id).toBe('m1');
  });

  it('容忍代码块包裹（宽容解析 JSON）', () => {
    const raw = '```json\n' + validOutputJson() + '\n```';
    expect(parseJevOutput(raw, inputOf())).not.toBeNull();
  });

  it('action 不在枚举内 ⇒ null', () => {
    expect(parseJevOutput(validOutputJson({ action: 'shout' }), inputOf())).toBeNull();
  });

  it('conflict 缺失 ⇒ null', () => {
    const raw = JSON.stringify({ action: 'share', motive_id: 'm1', inner_line: '一句话', reason_code: 'X_1' });
    expect(parseJevOutput(raw, inputOf())).toBeNull();
  });

  it('motive_id 不在候选内 ⇒ null（防止编造动机）', () => {
    expect(parseJevOutput(validOutputJson({ motive_id: 'ghost' }), inputOf())).toBeNull();
  });

  it('inner_line 超长 ⇒ null', () => {
    expect(parseJevOutput(validOutputJson({ inner_line: '字'.repeat(JEV_INNER_LINE_MAX + 1) }), inputOf())).toBeNull();
  });

  it('inner_line 夹带 Prompt 痕迹/引号 ⇒ null', () => {
    expect(parseJevOutput(validOutputJson({ inner_line: '【心里】想说' }), inputOf())).toBeNull();
    expect(parseJevOutput(validOutputJson({ inner_line: '她说「你好」' }), inputOf())).toBeNull();
  });

  it('reason_code 非大写枚举形态 ⇒ null', () => {
    expect(parseJevOutput(validOutputJson({ reason_code: 'keep_default' }), inputOf())).toBeNull();
  });

  it('非 JSON 文本 ⇒ null', () => {
    expect(parseJevOutput('我觉得应该分享。', inputOf())).toBeNull();
  });

  it('一致性护栏：输入没有"她低落"证据时，HER_LOW_* 理由一律拒绝（防编造她的状态）', () => {
    const noLow = inputOf({ lowPeriodActive: false, ruminationDominant: null, herActivated: {}, herValence: 0 });
    expect(parseJevOutput(validOutputJson({ reason_code: 'HER_LOW_HE_NEUTRAL' }), noLow)).toBeNull();
    // 同样输入下，非 HER_LOW 的理由仍可通过（护栏只拦编造，不拦正常决策）
    expect(parseJevOutput(validOutputJson({ reason_code: 'SHE_WANTS_TO_SHARE' }), noLow)).not.toBeNull();
  });

  it('一致性护栏：有"她低落"证据时，HER_LOW_* 允许（low_period / 负向情绪被激起 / valence 低）', () => {
    const viaLowPeriod = inputOf({ lowPeriodActive: true });
    expect(parseJevOutput(validOutputJson({ reason_code: 'HER_LOW_HE_RISES' }), viaLowPeriod)).not.toBeNull();
    // 方向：activated 正 = 被激起 ⇒ "被激起难过"是 sad **+0.08**（首版写成 -0.08 是反的）
    const viaActivated = inputOf({ lowPeriodActive: false, herActivated: { sad: 0.08 }, herValence: 0 });
    expect(parseJevOutput(validOutputJson({ reason_code: 'HER_LOW_HE_NEUTRAL' }), viaActivated)).not.toBeNull();
    // 8 轮真实样本里的真实形态：disgust +0.116（真低落证据）
    const viaDisgust = inputOf({ lowPeriodActive: false, herActivated: { disgust: 0.116 }, herValence: -0.066 });
    expect(parseJevOutput(validOutputJson({ reason_code: 'HER_LOW_HE_RISES' }), viaDisgust)).not.toBeNull();
    const viaValence = inputOf({ lowPeriodActive: false, herValence: -0.2 });
    expect(parseJevOutput(validOutputJson({ reason_code: 'HER_LOW_HE_RISES' }), viaValence)).not.toBeNull();
  });

  it('一致性护栏方向正确：负向情绪 delta 为负（基调被压下去）**不是**低落证据', () => {
    const suppressed = inputOf({ lowPeriodActive: false, herActivated: { sad: -0.08, fear: -0.06 }, herValence: 0 });
    expect(parseJevOutput(validOutputJson({ reason_code: 'HER_LOW_HE_NEUTRAL' }), suppressed)).toBeNull();
    // 死区以下的微正偏移也不算
    const noise = inputOf({ lowPeriodActive: false, herActivated: { sad: 0.03 }, herValence: 0 });
    expect(parseJevOutput(validOutputJson({ reason_code: 'HER_LOW_HE_NEUTRAL' }), noise)).toBeNull();
  });

  it('闭合枚举：模型自造的码（首跑真实出现过的 LOW_ENERGY_HIS_SAD）⇒ 拒绝', () => {
    expect(parseJevOutput(validOutputJson({ reason_code: 'LOW_ENERGY_HIS_SAD' }), inputOf())).toBeNull();
    expect(parseJevOutput(validOutputJson({ reason_code: 'LOW_MOOD_HOLD_SPACE' }), inputOf())).toBeNull();
  });

  it('一致性护栏：隐含冲突的理由要求 conflict=her_vs_his', () => {
    expect(parseJevOutput(validOutputJson({ reason_code: 'HER_LOW_HE_RISES', conflict: 'none' }), inputOf({ lowPeriodActive: true }))).toBeNull();
    expect(parseJevOutput(validOutputJson({ reason_code: 'KEEP_DEFAULT', conflict: 'none' }), inputOf())).not.toBeNull();
  });

  it('v1 护栏：HE_DOWN_* 要求他这一侧为负向情绪', () => {
    const hisNeutral = inputOf({ hisEmotion: 'neutral' });
    expect(parseJevOutput(validOutputJson({ reason_code: 'HE_DOWN_SHE_STEADY' }), hisNeutral)).toBeNull();
    const hisSad = inputOf({ hisEmotion: 'sad' });
    expect(parseJevOutput(validOutputJson({ reason_code: 'HE_DOWN_SHE_STEADY' }), hisSad)).not.toBeNull();
  });

  it('v1 护栏：BOTH_DOWN_* 要求她低 且 他为负', () => {
    const bothLowOk = inputOf({ hisEmotion: 'sad', lowPeriodActive: true });
    expect(parseJevOutput(validOutputJson({ reason_code: 'BOTH_DOWN_ACCOMPANY', conflict: 'her_vs_his' }), bothLowOk)).not.toBeNull();
    const hisJoy = inputOf({ hisEmotion: 'joy', lowPeriodActive: true });
    expect(parseJevOutput(validOutputJson({ reason_code: 'BOTH_DOWN_ACCOMPANY', conflict: 'her_vs_his' }), hisJoy)).toBeNull();
  });

  it('v1 输入：rules_default.reason_text 透传（v0 只有 STRATEGY_* 码）', () => {
    const input = inputOf();
    expect(input.version).toBe('jev-v1');
    expect(input.rules_default.reason_text).toContain('安静陪着');
  });

  it('v1 prompt：包含人设裁定、非冲突必须 KEEP、动作定义与 few-shot', () => {
    const prompt = buildJevPrompt(inputOf());
    expect(prompt).toContain('不是没有');
    expect(prompt).toContain('KEEP_DEFAULT');
    expect(prompt).toContain('share =');
    expect(prompt).toContain('例1');
  });
});

describe('jevAgrees', () => {
  it('action 与动机都一致 ⇒ true；任一不同 ⇒ false', () => {
    const input = inputOf();
    const same = parseJevOutput(validOutputJson({ action: 'wait', motive_id: 'm3' }), input)!;
    expect(jevAgrees(same, input)).toBe(true);
    const diff = parseJevOutput(validOutputJson({ action: 'share', motive_id: 'm3' }), input)!;
    expect(jevAgrees(diff, input)).toBe(false);
  });
});

describe('runJevShadow（永不抛异常，只记账）', () => {
  const dir = () => mkdtempSync(join(tmpdir(), 'jev-shadow-'));
  const logPath = (d: string) => join(d, 'jev_shadow.jsonl');

  it('成功 ⇒ 记录含 jev / agree / 延迟，并写入账本', async () => {
    const d = dir();
    const rec = await runJevShadow({
      turnId: 't-1',
      input: inputOf(),
      callModel: async () => validOutputJson({ action: 'wait', motive_id: 'm3' }),
      logPath: logPath(d),
    });
    expect(rec.jev).not.toBeNull();
    expect(rec.agree).toBe(true);
    expect(rec.errorCode).toBeNull();
    expect(rec.changedAction).toBe(false);
    expect(rec.inputDigest).toBe(jevInputDigest(rec.input));
    const lines = readFileSync(logPath(d), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).turnId).toBe('t-1');
  });

  it('账本 append-only：两次运行 ⇒ 两行', async () => {
    const d = dir();
    for (const id of ['t-1', 't-2']) {
      await runJevShadow({ turnId: id, input: inputOf(), callModel: async () => validOutputJson(), logPath: logPath(d) });
    }
    expect(readFileSync(logPath(d), 'utf8').trim().split('\n')).toHaveLength(2);
  });

  it('模型抛错 ⇒ CALL_FAILED，决策为 null，不抛给调用方', async () => {
    const rec = await runJevShadow({
      turnId: 't-2',
      input: inputOf(),
      callModel: async () => { throw new Error('network down'); },
      logPath: logPath(dir()),
    });
    expect(rec.errorCode).toBe('CALL_FAILED');
    expect(rec.jev).toBeNull();
    expect(rec.agree).toBeNull();
  });

  it('超时 ⇒ TIMEOUT（不阻塞、不抛异常）', async () => {
    const rec = await runJevShadow({
      turnId: 't-3',
      input: inputOf(),
      callModel: () => new Promise<string>(() => { /* 永不 resolve */ }),
      timeoutMs: 15,
      logPath: logPath(dir()),
    });
    expect(rec.errorCode).toBe('TIMEOUT');
    expect(rec.jev).toBeNull();
  });

  it('输出非法 ⇒ PARSE_FAILED，决策为 null（且保留原始输出便于归因）', async () => {
    const bad = '{"action":"shout","conflict":"none","inner_line":"x","reason_code":"A_1"}';
    const rec = await runJevShadow({
      turnId: 't-4',
      input: inputOf(),
      callModel: async () => bad,
      logPath: logPath(dir()),
    });
    expect(rec.errorCode).toBe('PARSE_FAILED');
    expect(rec.jev).toBeNull();
    expect(rec.rawHead).toContain('shout');
  });
});

describe('jevEnabled', () => {
  it('默认关；只有显式 true 才开', () => {
    expect(jevEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(jevEnabled({ ENABLE_JEV_DECISION: '1' } as NodeJS.ProcessEnv)).toBe(false);
    expect(jevEnabled({ ENABLE_JEV_DECISION: 'true' } as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe('v1 权限闸门（只接管冲突类）', () => {
  const dir = () => mkdtempSync(join(tmpdir(), 'jev-gate-'));

  it('非冲突轮（他难过/她稳）⇒ authority=none、limitations 含 authority-none', async () => {
    const rec = await runJevShadow({
      turnId: 'g1',
      input: inputOf({ hisEmotion: 'sad', lowPeriodActive: false, ruminationDominant: null, herValence: 0 }),
      callModel: async () => validOutputJson({ reason_code: 'HE_DOWN_SHE_STEADY', action: 'wait', motive_id: 'm3' }),
      logPath: join(dir(), 'l.jsonl'),
    });
    expect(rec.conflictClass).toBe(false);
    expect(rec.authority).toBe('none');
    expect(rec.limitations).toContain('authority-none');
  });

  it('冲突轮（她低落 + 他报喜）⇒ authority=conflict_only', async () => {
    const rec = await runJevShadow({
      turnId: 'g2',
      input: inputOf({ hisEmotion: 'joy', lowPeriodActive: true }),
      callModel: async () => validOutputJson({ reason_code: 'HER_LOW_HE_RISES', action: 'wait', motive_id: null }),
      logPath: join(dir(), 'l.jsonl'),
    });
    expect(rec.conflictClass).toBe(true);
    expect(rec.authority).toBe('conflict_only');
    expect(rec.limitations).not.toContain('authority-none');
  });

  it('wouldOverride = 意图改判（与是否生效无关；影子永不生效）', async () => {
    const rec = await runJevShadow({
      turnId: 'g3',
      input: inputOf({ hisEmotion: 'joy', lowPeriodActive: true }),
      callModel: async () => validOutputJson({ reason_code: 'HER_LOW_HE_RISES', action: 'wait', motive_id: null }),
      logPath: join(dir(), 'l.jsonl'),
    });
    expect(rec.wouldOverride).toBe(true); // 规则是 wait/m3，jev 是 wait/null ⇒ motive 不同
  });
});

describe('默认超时常量', () => {
  it('默认 2000ms（v1.59 修正：1200ms 离实测 p90 1149/max 1165 太近，20 条里出过 1 次超时）', () => {
    expect(JEV_DEFAULT_TIMEOUT_MS).toBe(2000);
  });
});
