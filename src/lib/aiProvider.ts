import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import { sleep } from './utils';

export interface AISettings {
  provider: 'gemini' | 'openai' | 'custom';
  apiKey: string;
  model: string;
  baseUrl?: string;
  enableWebSearch?: boolean;
  temperature?: number;
}

// Exponential backoff retry utility
async function retryAsync<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      // Determine if error is retryable
      const status = error?.status || error?.code;
      const isRetryable =
        // Network errors (no status code)
        !status ||
        // Rate limiting
        status === 429 ||
        // Server errors
        (status >= 500 && status < 600) ||
        // Specific OpenAI/Google API errors
        error?.message?.includes('timeout') ||
        error?.message?.includes('network') ||
        error?.message?.includes('ECONNREFUSED') ||
        error?.message?.includes('ETIMEDOUT');

      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }

      // Calculate exponential backoff with jitter
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 500;
      console.warn(`AI API call failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${Math.round(delay)}ms:`, error.message);
      await sleep(delay);
    }
  }

  throw lastError;
}

// ════════════════════════════════════════════════════════════
// Client 缓存 — 避免每次 API 调用都新建连接
// ════════════════════════════════════════════════════════════
const clientCache = new Map<string, GoogleGenAI | OpenAI>();

function getClientKey(provider: string, apiKey: string, baseUrl?: string): string {
  return `${provider}:${apiKey}:${baseUrl ?? ''}`;
}

function getOrCreateClient(settings: AISettings): GoogleGenAI | OpenAI {
  const key = getClientKey(settings.provider, settings.apiKey, settings.baseUrl);
  const cached = clientCache.get(key);
  if (cached) return cached;

  let client: GoogleGenAI | OpenAI;
  if (settings.provider === 'gemini') {
    client = new GoogleGenAI({ apiKey: settings.apiKey });
  } else {
    client = new OpenAI({
      apiKey: settings.apiKey,
      baseURL: settings.baseUrl || undefined,
    });
  }
  clientCache.set(key, client);
  return client;
}

export function clearClientCache(): void {
  clientCache.clear();
}

export async function generateAIResponse(
  settings: AISettings,
  systemPrompt: string,
  userPrompt: string,
  isJson: boolean = false,
  temperature: number = 0.7
): Promise<string> {
  if (!settings || !settings.apiKey) {
    throw new Error('API Key not configured');
  }

  return retryAsync(async () => {
    if (settings.provider === 'gemini') {
      const ai = getOrCreateClient(settings) as GoogleGenAI;
      const response = await ai.models.generateContent({
        model: settings.model || 'gemini-3-flash-preview',
        contents: userPrompt,
        config: {
          systemInstruction: systemPrompt,
          maxOutputTokens: 600,
          responseMimeType: isJson ? "application/json" : "text/plain",
          temperature,
          tools: settings.enableWebSearch ? [{ googleSearch: {} }] : undefined,
          safetySettings: [
            {
              category: "HARM_CATEGORY_HATE_SPEECH",
              threshold: "BLOCK_MEDIUM_AND_ABOVE",
            },
            {
              category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
              threshold: "BLOCK_MEDIUM_AND_ABOVE",
            },
            {
              category: "HARM_CATEGORY_DANGEROUS_CONTENT",
              threshold: "BLOCK_MEDIUM_AND_ABOVE",
            },
            {
              category: "HARM_CATEGORY_HARASSMENT",
              threshold: "BLOCK_MEDIUM_AND_ABOVE",
            }
          ] as any
        }
      });
      return response.text || (isJson ? '{}' : '');
    } else {
      const openai = getOrCreateClient(settings) as OpenAI;
      const response = await openai.chat.completions.create({
        model: settings.model || 'gpt-4-turbo',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: isJson ? { type: "json_object" } : undefined,
        temperature,
      });
      return response.choices[0].message.content || (isJson ? '{}' : '');
    }
  }, 3, 1000);
}

export async function generateEmbeddings(
  settings: AISettings,
  text: string
): Promise<number[]> {
  if (!settings || !settings.apiKey) {
    throw new Error('API Key not configured');
  }

  // Special handling for custom provider 404 errors (skip retry)
  if (settings.provider === 'custom') {
    try {
      return await retryAsync(async () => {
        const openai = getOrCreateClient(settings) as OpenAI;
        const response = await openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: text,
        });
        return response.data[0].embedding;
      }, 3, 1000);
    } catch (error: any) {
      if (error.status === 404) {
        console.warn('Custom provider does not support embeddings or model not found. Skipping embedding generation.');
        return [];
      }
      throw error;
    }
  }

  return retryAsync(async () => {
    if (settings.provider === 'gemini') {
      const ai = getOrCreateClient(settings) as GoogleGenAI;
      const response = await ai.models.embedContent({
        model: 'text-embedding-004',
        contents: text,
      });
      return response.embeddings?.[0]?.values || [];
    } else {
      const openai = getOrCreateClient(settings) as OpenAI;
      const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
      });
      return response.data[0].embedding;
    }
  }, 3, 1000);
}

export async function generateAIChatResponse(
  settings: AISettings,
  systemPrompt: string,
  messages: { role: 'user' | 'assistant', content: string, imageUrl?: string }[],
  isJson: boolean = false,
  temperature: number = 0.7,
  tools?: any[]
): Promise<{ text: string, functionCalls?: any[] }> {
  if (!settings || !settings.apiKey) {
    throw new Error('API Key not configured');
  }

  return retryAsync(async () => {
    if (settings.provider === 'gemini') {
      const ai = getOrCreateClient(settings) as GoogleGenAI;

      const contents = messages.map(msg => {
        const parts: any[] = [];
        if (msg.imageUrl) {
          // Extract base64 and mimeType
          const match = msg.imageUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
          if (match) {
            parts.push({
              inlineData: {
                mimeType: match[1],
                data: match[2]
              }
            });
          }
        }
        if (msg.content) {
          parts.push({ text: msg.content });
        }
        return {
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts
        };
      });

      const finalTools = [];
      if (settings.enableWebSearch) finalTools.push({ googleSearch: {} });
      if (tools) finalTools.push(...tools);

      const response = await ai.models.generateContent({
        model: settings.model || 'gemini-3-flash-preview',
        contents,
        config: {
          systemInstruction: systemPrompt,
          maxOutputTokens: 600,
          responseMimeType: isJson ? "application/json" : "text/plain",
          temperature,
          tools: finalTools.length > 0 ? finalTools : undefined,
          safetySettings: [
            {
              category: "HARM_CATEGORY_HATE_SPEECH",
              threshold: "BLOCK_MEDIUM_AND_ABOVE",
            },
            {
              category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
              threshold: "BLOCK_MEDIUM_AND_ABOVE",
            },
            {
              category: "HARM_CATEGORY_DANGEROUS_CONTENT",
              threshold: "BLOCK_MEDIUM_AND_ABOVE",
            },
            {
              category: "HARM_CATEGORY_HARASSMENT",
              threshold: "BLOCK_MEDIUM_AND_ABOVE",
            }
          ] as any
        }
      });
      return {
        text: response.text || (isJson ? '{}' : ''),
        functionCalls: response.functionCalls
      };
    } else {
      // OpenAI / DeepSeek / 兼容提供商
      const openai = getOrCreateClient(settings) as OpenAI;

      // ponytail: 把 imageUrl 转成 OpenAI vision 格式
      const apiMessages = messages.map(msg => {
        if (msg.imageUrl) {
          return {
            role: msg.role,
            content: [
              { type: 'text' as const, text: msg.content },
              { type: 'image_url' as const, image_url: { url: msg.imageUrl } },
            ],
          };
        }
        return { role: msg.role, content: msg.content };
      });

      // DeepSeek 不支持图片
      if ((settings as any).provider === 'deepseek') {
        const hasImage = messages.some(m => m.imageUrl);
        if (hasImage) {
          throw new Error('DeepSeek 不支持图片分析，请使用 Gemini 或 GPT-4V');
        }
      }

      const response = await openai.chat.completions.create({
        model: settings.model || 'gpt-4-turbo',
        messages: [
          { role: 'system', content: systemPrompt },
          ...apiMessages as any,
        ],
        max_tokens: 600,
        response_format: isJson ? { type: "json_object" } : undefined,
        temperature,
      });
      return { text: response.choices[0].message.content || (isJson ? '{}' : '') };
    }
  }, 3, 1000);
}