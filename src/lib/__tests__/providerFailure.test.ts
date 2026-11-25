import { describe, expect, it } from 'vitest';
import { classifyProviderFailure, providerFailureHint } from '../providerFailure';

describe('provider failure diagnostics', () => {
  it.each([
    [401, 'auth_rejected'],
    [402, 'insufficient_balance'],
    [403, 'permission_denied'],
    [404, 'endpoint_or_model_not_found'],
    [429, 'rate_limited'],
    [503, 'provider_unavailable'],
    [400, 'invalid_request'],
  ] as const)('classifies HTTP %i without exposing provider text', (status, expected) => {
    const code = classifyProviderFailure({ status, message: 'private provider response' });
    expect(code).toBe(expected);
    expect(providerFailureHint(code)).not.toContain('private provider response');
  });

  it('follows wrapped causes to find network codes', () => {
    expect(classifyProviderFailure({
      name: 'AIRequestError',
      cause: { code: 'ECONNRESET', message: 'private detail' },
    })).toBe('network_unreachable');
  });

  it('recognizes timeouts and keeps unknown failures generic', () => {
    expect(classifyProviderFailure({ code: 'ETIMEDOUT' })).toBe('request_timeout');
    expect(classifyProviderFailure(new Error('private error text'))).toBe('unknown_provider_error');
    expect(providerFailureHint('unknown_provider_error')).not.toContain('private error text');
  });
});
