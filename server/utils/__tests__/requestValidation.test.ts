import { describe, expect, it } from 'vitest';
import { parseChatRequest, parseTtsRequest, parseVisionRequest } from '../requestValidation.js';

describe('requestValidation', () => {
  it('accepts a bounded chat request', () => {
    const result = parseChatRequest({
      message: ' hello ',
      recentMessages: [{ role: 'assistant', content: 'hi' }],
      settings: { temperature: 0.5, baseUrl: 'https://example.com/v1' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.message).toBe('hello');
  });

  it('rejects malformed or excessive chat input', () => {
    expect(parseChatRequest({ message: { text: 'bad' } }).ok).toBe(false);
    expect(parseChatRequest({ message: 'x'.repeat(8_001) }).ok).toBe(false);
    expect(parseChatRequest({ message: 'ok', settings: { temperature: 9 } }).ok).toBe(false);
    expect(parseChatRequest({ message: 'ok', settings: { baseUrl: 'file:///secret' } }).ok).toBe(false);
  });

  it('validates TTS voice and image boundaries', () => {
    expect(parseTtsRequest({ text: 'hello', voice: '--help' }).ok).toBe(false);
    expect(parseTtsRequest({ text: 'hello', voice: 'zh-CN-XiaoxiaoNeural' }).ok).toBe(true);
    expect(parseVisionRequest({ imageBase64: 'abc', mimeType: 'image/svg+xml' }).ok).toBe(false);
    expect(parseVisionRequest({ imageBase64: 'abc', mimeType: 'image/png' }).ok).toBe(true);
  });
});
