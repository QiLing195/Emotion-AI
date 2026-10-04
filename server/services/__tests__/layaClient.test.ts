// ── Laya 传输层单元测试（v1.33）──
// 锁死的是**不变量**，不是实现：
//   ① 默认 off ⇒ **一次网络都不发**（一个外部依赖不能悄悄出现在主链路上）
//   ② 任何失败（HTTP 错 / 超时 / 垃圾响应）⇒ null，**绝不抛**
//   ③ 连续失败会熔断，熔断期间连 fetch 都不调（省掉每轮的 timeout 等待）
//   ④ 中文输入必须显式指定 multilingual checkpoint（英文那个在非英文上会"高置信度乱答"）
//   ⑤ 统计要能读出"它到底跑没跑、跑得多快、错在哪"

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  predictLayaStrategy,
  layaStrategyMode,
  layaEndpoint,
  layaTimeoutMs,
  layaMinConfidence,
  layaKeepAccompany,
  layaStats,
  resetLayaBreaker,
  layaHealth,
} from '../layaClient';
import { LAYA_CHOOSABLE_STRATEGIES, LAYA_STANCE_QUESTION_ID } from '../../../src/lib/layaDecision';

function okResponse(choice = 'empathize') {
  return {
    model: 'laya-rl-agent',
    answers: {
      [LAYA_STANCE_QUESTION_ID]: {
        type: 'choice',
        choice,
        probabilities: { empathize: 0.66, neutral: 0.13, accompany: 0.11 },
        confidence: 0.42,
      },
    },
    usage: { input_tokens: 210, output_tokens: 0 },
    routing: { model: 'multilingual', reason: "explicit model='multilingual'" },
  };
}

const INPUT = { userText: '我今天面试又挂了' };
const LAYAS_ALL = LAYA_CHOOSABLE_STRATEGIES;

beforeEach(() => {
  resetLayaBreaker();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('配置读取', () => {
  it('模式：只有 on/shadow 算开启，其余（含拼错）一律 off', () => {
    vi.stubEnv('LAYA_STRATEGY', '');
    expect(layaStrategyMode()).toBe('off');
    vi.stubEnv('LAYA_STRATEGY', 'shadow');
    expect(layaStrategyMode()).toBe('shadow');
    vi.stubEnv('LAYA_STRATEGY', 'ON');
    expect(layaStrategyMode()).toBe('on');
    vi.stubEnv('LAYA_STRATEGY', 'true');
    expect(layaStrategyMode()).toBe('off');
    vi.stubEnv('LAYA_STRATEGY', 'yes');
    expect(layaStrategyMode()).toBe('off');
  });

  it('endpoint 去掉尾部斜杠（否则拼出 //v1/systemone）', () => {
    vi.stubEnv('LAYA_ENDPOINT', 'http://127.0.0.1:8790///');
    expect(layaEndpoint()).toBe('http://127.0.0.1:8790');
  });

  it('超时/门限有兜底，且非法值不会变成 NaN', () => {
    vi.stubEnv('LAYA_TIMEOUT_MS', 'abc');
    expect(layaTimeoutMs()).toBe(1500);
    vi.stubEnv('LAYA_MIN_CONFIDENCE', 'abc');
    expect(layaMinConfidence()).toBe(0.5);
    vi.stubEnv('LAYA_MIN_CONFIDENCE', '5');
    expect(layaMinConfidence()).toBe(1);   // 钳到 [0,1]
    vi.stubEnv('LAYA_TIMEOUT_MS', '10');
    expect(layaTimeoutMs()).toBe(100);     // 下限：比一次 CPU 前向还短的超时毫无意义
  });

  it('keepAccompany 默认开，只有明确写 false 才回退（写错不会静默改变行为）', () => {
    vi.stubEnv('LAYA_KEEP_ACCOMPANY', '');
    expect(layaKeepAccompany()).toBe(true);
    vi.stubEnv('LAYA_KEEP_ACCOMPANY', 'true');
    expect(layaKeepAccompany()).toBe(true);
    vi.stubEnv('LAYA_KEEP_ACCOMPANY', 'flase');   // 拼错 → 保持默认（与 DISABLE_* 同一约定）
    expect(layaKeepAccompany()).toBe(true);
    vi.stubEnv('LAYA_KEEP_ACCOMPANY', 'false');
    expect(layaKeepAccompany()).toBe(false);
  });
});

describe('predictLayaStrategy —— 默认 off 时一次网络都不发', () => {
  it('off：返回 null 且 fetch 从未被调用', async () => {
    vi.stubEnv('LAYA_STRATEGY', 'off');
    const fetchImpl = vi.fn();
    const v = await predictLayaStrategy({
      input: INPUT, allowed: LAYA_CHOOSABLE_STRATEGIES, fetchImpl: fetchImpl as never,
    });
    expect(v).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(layaStats().calls).toBe(0);
  });

  it('on：请求体里带着他的原话 + 选项 + 显式 multilingual', async () => {
    vi.stubEnv('LAYA_STRATEGY', 'on');
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(okResponse()), { status: 200 }));
    const v = await predictLayaStrategy({
      input: INPUT, allowed: LAYA_CHOOSABLE_STRATEGIES, fetchImpl: fetchImpl as never,
    });
    expect(v?.strategy).toBe('empathize');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:8790/v1/systemone');
    const body = JSON.parse(String(init.body));
    expect(body.state).toContain('我今天面试又挂了');
    expect(body.model).toBe('multilingual');       // ④ 中文必须走多语言那个
    expect(Object.keys(body.questions[LAYA_STANCE_QUESTION_ID].criteria))
      .toEqual([...LAYAS_ALL]);
    expect(layaStats().ok).toBe(1);
  });

  it('设置了 LAYA_API_KEY 才带 Authorization', async () => {
    vi.stubEnv('LAYA_STRATEGY', 'on');
    const fetchImpl = vi.fn(async (..._args: unknown[]) => new Response(JSON.stringify(okResponse()), { status: 200 }));
    const sentHeaders = (): Record<string, string> =>
      ((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>);
    await predictLayaStrategy({ input: INPUT, allowed: LAYAS_ALL, fetchImpl: fetchImpl as never });
    expect(sentHeaders().authorization).toBeUndefined();
    resetLayaBreaker();
    fetchImpl.mockClear();
    vi.stubEnv('LAYA_API_KEY', 'secret');
    await predictLayaStrategy({ input: INPUT, allowed: LAYAS_ALL, fetchImpl: fetchImpl as never });
    expect(sentHeaders().authorization).toBe('Bearer secret');
  });
});

describe('predictLayaStrategy —— 任何失败都只是"没意见"', () => {
  it('HTTP 500 → null + 记账', async () => {
    vi.stubEnv('LAYA_STRATEGY', 'on');
    const fetchImpl = vi.fn(async () => new Response('boom', { status: 500 }));
    const v = await predictLayaStrategy({ input: INPUT, allowed: LAYAS_ALL, fetchImpl: fetchImpl as never });
    expect(v).toBeNull();
    expect(layaStats().failed).toBe(1);
    expect(layaStats().lastError).toContain('500');
  });

  it('超时/网络异常 → null（不抛）', async () => {
    vi.stubEnv('LAYA_STRATEGY', 'on');
    const fetchImpl = vi.fn(async () => { throw new DOMException('aborted', 'TimeoutError'); });
    const v = await predictLayaStrategy({ input: INPUT, allowed: LAYAS_ALL, fetchImpl: fetchImpl as never });
    expect(v).toBeNull();
    expect(layaStats().lastError).toContain('TimeoutError');
  });

  it('响应能解析但没有 stance → null（JSON 坏了也不算意见）', async () => {
    vi.stubEnv('LAYA_STRATEGY', 'on');
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ answers: {} }), { status: 200 }));
    expect(await predictLayaStrategy({ input: INPUT, allowed: LAYAS_ALL, fetchImpl: fetchImpl as never })).toBeNull();
    expect(layaStats().failed).toBe(1);
  });

  it('连续失败到阈值后熔断：后续调用连 fetch 都不调（不再白等一次超时）', async () => {
    vi.stubEnv('LAYA_STRATEGY', 'on');
    vi.stubEnv('LAYA_BREAKER_FAILS', '2');
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    await predictLayaStrategy({ input: INPUT, allowed: LAYAS_ALL, fetchImpl: fetchImpl as never });
    await predictLayaStrategy({ input: INPUT, allowed: LAYAS_ALL, fetchImpl: fetchImpl as never });
    expect(layaStats().breakerOpen).toBe(true);
    const before = fetchImpl.mock.calls.length;
    const v = await predictLayaStrategy({ input: INPUT, allowed: LAYAS_ALL, fetchImpl: fetchImpl as never });
    expect(v).toBeNull();
    expect(fetchImpl.mock.calls.length).toBe(before);
    expect(layaStats().breakerSkips).toBe(1);
  });

  it('成功一次就把连续失败计数清零（偶发失败不该累积成熔断）', async () => {
    vi.stubEnv('LAYA_STRATEGY', 'on');
    const bad = vi.fn(async () => new Response('x', { status: 502 }));
    await predictLayaStrategy({ input: INPUT, allowed: LAYAS_ALL, fetchImpl: bad as never });
    expect(layaStats().consecutiveFailures).toBe(1);
    const good = vi.fn(async () => new Response(JSON.stringify(okResponse()), { status: 200 }));
    await predictLayaStrategy({ input: INPUT, allowed: LAYAS_ALL, fetchImpl: good as never });
    expect(layaStats().consecutiveFailures).toBe(0);
  });
});

describe('layaHealth', () => {
  it('sidecar 活着 → ok，并回报载入了哪些 checkpoint', async () => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ status: 'ok', loaded: ['multilingual'], device: 'cpu' }), { status: 200 },
    ));
    const h = await layaHealth(fetchImpl as never);
    expect(h.ok).toBe(true);
    expect(h.detail).toContain('multilingual');
  });

  it('sidecar 没起来 → ok=false + 原因（而不是抛异常）', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    const h = await layaHealth(fetchImpl as never);
    expect(h.ok).toBe(false);
    expect(h.detail).toContain('ECONNREFUSED');
  });
});
