import { describe, expect, it } from 'vitest';
import { AIRequestError, DefaultAIEngine, appendCurrentUserMessage } from '../aiEngine.js';

describe('appendCurrentUserMessage', () => {
  it('appends the current turn to existing history', () => {
    const messages = appendCurrentUserMessage([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
    ], 'current');

    expect(messages.at(-1)).toEqual({ role: 'user', content: 'current' });
  });

  it('does not duplicate a current turn already added by the client', () => {
    const messages = appendCurrentUserMessage([
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'current' },
    ], 'current');

    expect(messages.filter(message => message.content === 'current')).toHaveLength(1);
  });

  it('drops invalid roles and keeps a bounded history', () => {
    const history = Array.from({ length: 25 }, (_, index) => ({
      role: index === 0 ? 'system' : index % 2 ? 'user' : 'assistant',
      content: String(index),
    }));
    const messages = appendCurrentUserMessage(history, 'current');

    expect(messages).toHaveLength(21);
    expect(messages.some(message => message.role === ('system' as any))).toBe(false);
  });

  it('throws a typed error instead of returning a fake successful reply', async () => {
    const engine = new DefaultAIEngine();
    await expect(engine.generateResponse('hello', undefined, {
      clientSystemPrompt: 'test',
    })).rejects.toBeInstanceOf(AIRequestError);
  });
});
