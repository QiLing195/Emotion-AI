import { afterEach, describe, expect, it } from 'vitest';
import { clearAICallMetrics, getAICallMetrics, recordAICallMetric } from '../aiCallMetrics';

afterEach(() => clearAICallMetrics());

describe('AI provider call metrics', () => {
  it('aggregates latency, failures, providers, and reported tokens by stage', () => {
    const now = 1_800_000_000_000;
    recordAICallMetric({
      at: now - 100, stage: 'emotion_analysis', provider: 'openai', model: 'test-model',
      durationMs: 120, ok: true, promptTokens: 40, completionTokens: 12, totalTokens: 52,
    });
    recordAICallMetric({
      at: now - 50, stage: 'emotion_analysis', provider: 'openai', model: 'test-model',
      durationMs: 300, ok: false, promptTokens: null, completionTokens: null, totalTokens: null,
    });
    recordAICallMetric({
      at: now - 10, stage: 'chat_response', provider: 'gemini', model: 'test-chat',
      durationMs: 800, ok: true, promptTokens: 100, completionTokens: 30, totalTokens: 130,
    });

    const snapshot = getAICallMetrics(1_000, now);
    expect(snapshot.calls).toBe(3);
    expect(snapshot.byStage.emotion_analysis).toMatchObject({
      calls: 2,
      succeeded: 1,
      failed: 1,
      durationMs: { p50: 120, p95: 300, max: 300 },
      tokens: { prompt: 40, completion: 12, total: 52, reportedCalls: 1 },
      providers: ['openai/test-model'],
    });
    expect(snapshot.byStage.chat_response.tokens.total).toBe(130);
  });

  it('excludes calls outside the requested time window', () => {
    const now = 1_800_000_000_000;
    recordAICallMetric({
      at: now - 10_000, stage: 'query_embedding', provider: 'openai', model: 'embed',
      durationMs: 10, ok: true, promptTokens: 5, completionTokens: 0, totalTokens: 5,
    });
    const snapshot = getAICallMetrics(1_000, now);
    expect(snapshot.calls).toBe(0);
    expect(snapshot.retainedCalls).toBe(1);
  });
});
