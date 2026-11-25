export type AICallStage =
  | 'emotion_analysis'
  | 'query_embedding'
  | 'chat_response'
  | 'dedup_rewrite'
  | 'agent_response'
  | 'other';

export interface AICallMetric {
  at: number;
  stage: AICallStage;
  provider: string;
  model: string;
  durationMs: number;
  ok: boolean;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

const MAX_METRICS = 500;
const metrics: AICallMetric[] = [];

export function recordAICallMetric(metric: AICallMetric): void {
  metrics.push({
    ...metric,
    at: Number.isFinite(metric.at) ? metric.at : Date.now(),
    durationMs: Math.max(0, Math.round(metric.durationMs)),
  });
  if (metrics.length > MAX_METRICS) metrics.splice(0, metrics.length - MAX_METRICS);
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

export function getAICallMetrics(windowMs = 60 * 60_000, now = Date.now()) {
  const since = now - Math.max(0, windowMs);
  const recent = metrics.filter(metric => metric.at >= since && metric.at <= now);
  const stages = [...new Set(recent.map(metric => metric.stage))].sort();
  return {
    windowMs: Math.max(0, windowMs),
    retainedCalls: metrics.length,
    calls: recent.length,
    byStage: Object.fromEntries(stages.map(stage => {
      const rows = recent.filter(metric => metric.stage === stage);
      const successful = rows.filter(metric => metric.ok);
      const prompt = successful.map(metric => metric.promptTokens).filter((n): n is number => n !== null);
      const completion = successful.map(metric => metric.completionTokens).filter((n): n is number => n !== null);
      const total = successful.map(metric => metric.totalTokens).filter((n): n is number => n !== null);
      const durations = rows.map(metric => metric.durationMs);
      return [stage, {
        calls: rows.length,
        succeeded: successful.length,
        failed: rows.length - successful.length,
        durationMs: {
          p50: percentile(durations, 0.5),
          p95: percentile(durations, 0.95),
          max: durations.length ? Math.max(...durations) : null,
        },
        tokens: {
          prompt: prompt.length ? prompt.reduce((sum, n) => sum + n, 0) : null,
          completion: completion.length ? completion.reduce((sum, n) => sum + n, 0) : null,
          total: total.length ? total.reduce((sum, n) => sum + n, 0) : null,
          reportedCalls: total.length,
        },
        providers: [...new Set(rows.map(metric => `${metric.provider}/${metric.model}`))].sort(),
      }];
    })),
  };
}

export function clearAICallMetrics(): void {
  metrics.length = 0;
}
