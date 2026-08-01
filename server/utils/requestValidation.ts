type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface ChatRequestData {
  message: string;
  userId?: string;
  persona?: any;
  settings?: any;
  recentMessages?: { role: 'user' | 'assistant'; content: string; imageUrl?: string }[];
  recentMemories?: unknown;
  chatSummary?: unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function parseChatRequest(body: unknown): ValidationResult<ChatRequestData> {
  if (!isObject(body)) return { ok: false, error: 'Request body must be a JSON object' };
  if (typeof body.message !== 'string' || !body.message.trim()) {
    return { ok: false, error: 'Message is required' };
  }
  if (body.message.length > 8_000) return { ok: false, error: 'Message exceeds 8000 characters' };
  if (body.userId !== undefined && (typeof body.userId !== 'string' || body.userId.length > 200)) {
    return { ok: false, error: 'Invalid userId' };
  }
  if (body.persona !== undefined && !isObject(body.persona)) return { ok: false, error: 'Invalid persona' };
  if (body.settings !== undefined && !isObject(body.settings)) return { ok: false, error: 'Invalid settings' };

  let recentMessages: ChatRequestData['recentMessages'];
  if (body.recentMessages !== undefined) {
    if (!Array.isArray(body.recentMessages) || body.recentMessages.length > 40) {
      return { ok: false, error: 'recentMessages must contain at most 40 messages' };
    }
    let totalLength = 0;
    recentMessages = [];
    for (const item of body.recentMessages) {
      if (!isObject(item) || (item.role !== 'user' && item.role !== 'assistant') || typeof item.content !== 'string') {
        return { ok: false, error: 'Invalid recentMessages entry' };
      }
      if (item.content.length > 16_000) return { ok: false, error: 'History message is too long' };
      totalLength += item.content.length;
      if (totalLength > 80_000) return { ok: false, error: 'Conversation history is too large' };
      recentMessages.push({
        role: item.role,
        content: item.content,
        imageUrl: typeof item.imageUrl === 'string' && item.imageUrl.length <= 10_000_000 ? item.imageUrl : undefined,
      });
    }
  }

  const settings = body.settings as Record<string, unknown> | undefined;
  if (settings?.temperature !== undefined && (
    typeof settings.temperature !== 'number'
    || !Number.isFinite(settings.temperature)
    || settings.temperature < 0
    || settings.temperature > 2
  )) return { ok: false, error: 'Temperature must be between 0 and 2' };
  if (settings?.baseUrl !== undefined) {
    if (typeof settings.baseUrl !== 'string' || settings.baseUrl.length > 500) {
      return { ok: false, error: 'Invalid baseUrl' };
    }
    try {
      const url = new URL(settings.baseUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, error: 'Invalid baseUrl protocol' };
    } catch {
      return { ok: false, error: 'Invalid baseUrl' };
    }
  }

  return {
    ok: true,
    value: {
      message: body.message.trim(),
      userId: body.userId as string | undefined,
      persona: body.persona,
      settings: body.settings,
      recentMessages,
      recentMemories: body.recentMemories,
      chatSummary: body.chatSummary,
    },
  };
}

export function parseVisionRequest(body: unknown): ValidationResult<{ imageBase64: string; mimeType: string; mode: string }> {
  if (!isObject(body) || typeof body.imageBase64 !== 'string' || !body.imageBase64) {
    return { ok: false, error: 'Image is required' };
  }
  if (body.imageBase64.length > 10_000_000) return { ok: false, error: 'Image exceeds 7.5 MB' };
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType : 'image/jpeg';
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
    return { ok: false, error: 'Unsupported image type' };
  }
  const mode = body.mode === 'emotion' ? 'emotion' : 'full';
  return { ok: true, value: { imageBase64: body.imageBase64, mimeType, mode } };
}

export function parseTtsRequest(body: unknown): ValidationResult<{ text: string; voice: string }> {
  if (!isObject(body) || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 500) {
    return { ok: false, error: 'Text is required and must not exceed 500 characters' };
  }
  const voice = typeof body.voice === 'string' ? body.voice : 'zh-CN-XiaoxiaoNeural';
  if (!/^[a-zA-Z]{2,3}-[a-zA-Z]{2,4}-[a-zA-Z0-9-]{1,80}$/.test(voice)) {
    return { ok: false, error: 'Invalid voice' };
  }
  return { ok: true, value: { text: body.text, voice } };
}
