/** Safe, content-free classification for errors returned by an AI provider SDK. */
export type ProviderFailureCode =
  | 'auth_rejected'
  | 'insufficient_balance'
  | 'permission_denied'
  | 'endpoint_or_model_not_found'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'request_timeout'
  | 'network_unreachable'
  | 'invalid_request'
  | 'unknown_provider_error';

type ErrorLike = {
  status?: unknown;
  statusCode?: unknown;
  code?: unknown;
  name?: unknown;
  message?: unknown;
  cause?: unknown;
  response?: { status?: unknown };
};

function asErrorLike(value: unknown): ErrorLike | null {
  return value !== null && typeof value === 'object' ? value as ErrorLike : null;
}

/** Walks only structured error metadata; raw messages are never returned or logged. */
export function classifyProviderFailure(error: unknown): ProviderFailureCode {
  const chain: ErrorLike[] = [];
  let current: unknown = error;
  for (let i = 0; i < 5; i += 1) {
    const item = asErrorLike(current);
    if (!item) break;
    chain.push(item);
    current = item.cause;
  }

  const statuses = chain
    .flatMap(item => [item.status, item.statusCode, item.response?.status])
    .map(Number)
    .filter(Number.isFinite);
  if (statuses.includes(401)) return 'auth_rejected';
  if (statuses.includes(402)) return 'insufficient_balance';
  if (statuses.includes(403)) return 'permission_denied';
  if (statuses.includes(404)) return 'endpoint_or_model_not_found';
  if (statuses.includes(429)) return 'rate_limited';
  if (statuses.some(status => status >= 500 && status < 600)) return 'provider_unavailable';
  if (statuses.some(status => status >= 400 && status < 500)) return 'invalid_request';

  const codes = chain.map(item => String(item.code ?? '').toUpperCase());
  if (codes.some(code => /TIMEOUT|ETIMEDOUT|ABORT_ERR/.test(code))
    || chain.some(item => item.name === 'AbortError' || item.name === 'TimeoutError')) {
    return 'request_timeout';
  }
  if (codes.some(code => /ECONN|ENOTFOUND|EAI_AGAIN|DNS|CERT|TLS|SOCKET/.test(code))) {
    return 'network_unreachable';
  }
  return 'unknown_provider_error';
}

export function providerFailureHint(code: ProviderFailureCode | string): string {
  switch (code) {
    case 'auth_rejected': return '模型服务拒绝了 API Key（401）。请检查当前选中的 Provider 密钥。';
    case 'insufficient_balance': return '模型服务账户余额或额度不足（402）。';
    case 'permission_denied': return '当前密钥没有调用该模型的权限（403）。';
    case 'endpoint_or_model_not_found': return '模型地址或模型名不存在（404）。请核对 Provider、模型名和 API 地址。';
    case 'rate_limited': return '模型服务触发限流（429）。请稍后再试或检查账户配额。';
    case 'provider_unavailable': return '模型服务暂时不可用（5xx）。稍后重试并查看服务状态。';
    case 'request_timeout': return '模型请求超时。请检查网络，或缩短请求上下文。';
    case 'network_unreachable': return '无法连接模型服务。请检查网络、代理、DNS 或 TLS。';
    case 'invalid_request': return '模型服务拒绝了请求参数（4xx）。请核对模型配置。';
    default: return '聊天请求失败，未能安全识别具体原因；可查看本机服务端错误日志。';
  }
}
