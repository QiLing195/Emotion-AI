import { INITIAL_EMOTION_STATE } from '../../src/lib/emotionEngine.js';
import type { EmotionState } from '../../src/lib/emotionEngine.js';
import { generateAIResponse, generateAIChatResponse } from '../../src/lib/aiProvider.js';
import type { AISettings } from '../../src/lib/aiProvider.js';
import { firebaseService } from './firebase.js';
import { executeStrongConnection } from '../../src/lib/moduleConnections.js';

export interface ChatResponse {
  text: string;
  emotionState?: EmotionState;
}

export interface ClientContext {
  clientSystemPrompt?: string;
  clientSettings?: AISettings;
  persona?: any;
  emotionState?: EmotionState;
  recentMessages?: { role: string; content: string; imageUrl?: string }[];
}

export class AIRequestError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AIRequestError';
  }
}

export function appendCurrentUserMessage(
  messages: { role: string; content: string; imageUrl?: string }[],
  userText: string,
): { role: 'user' | 'assistant'; content: string; imageUrl?: string }[] {
  const normalized = messages
    .filter(message => (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string')
    .slice(-20) as { role: 'user' | 'assistant'; content: string; imageUrl?: string }[];
  const last = normalized.at(-1);

  if (last?.role === 'user' && last.content === userText) return normalized;
  return [...normalized, { role: 'user', content: userText }];
}

export class DefaultAIEngine {
  private config: any = null;
  emotionState: EmotionState = INITIAL_EMOTION_STATE;

  setConfig(config: any): void {
    this.config = config;
  }

  async generateResponse(userText: string, userId?: string, clientContext?: ClientContext): Promise<ChatResponse> {
    if (clientContext?.clientSystemPrompt) {
      const aiSettings = clientContext.clientSettings;
      const authoritativeState = clientContext.emotionState
        ?? this.emotionState;

      if (!aiSettings) {
        throw new AIRequestError('AI settings are not configured.');
      }

      try {
        let text: string;
        if (clientContext.recentMessages?.length) {
          const messages = appendCurrentUserMessage(clientContext.recentMessages, userText);
          const result = await executeStrongConnection('S4',
            () => generateAIChatResponse(
              aiSettings,
              clientContext.clientSystemPrompt,
              messages,
              false,
              aiSettings.temperature ?? 0.7,
            ),
            () => ({ text: '嗯，我在。' }),
          );
          text = result.text;
        } else {
          text = await executeStrongConnection('S4',
            () => generateAIResponse(
              aiSettings,
              clientContext.clientSystemPrompt,
              userText,
              false,
              aiSettings.temperature ?? 0.7,
            ),
            () => '嗯，我在。',
          );
        }

        await this.persistMessages(userId, userText, text);
        return { text, emotionState: authoritativeState };
      } catch (error: any) {
        console.error('[AIEngine] Error:', error);
        if (error instanceof AIRequestError) throw error;
        throw new AIRequestError(error?.message || 'AI request failed', { cause: error });
      }
    }

    let currentConfig = this.config;
    let currentEmotionState = this.emotionState;

    if (userId) {
      try {
        const userData = await firebaseService.getUserData(userId);
        if (userData?.config) currentConfig = userData.config;
        if (userData?.emotionState) currentEmotionState = userData.emotionState;
      } catch (error) {
        console.error('Failed to load user data from Firestore:', error);
      }
    }

    if (!currentConfig?.aiSettings || !currentConfig?.persona) {
      throw new AIRequestError('AI settings are not configured.');
    }

    try {
      const text = await executeStrongConnection('S4',
        () => generateAIResponse(
          currentConfig.aiSettings,
          currentConfig.persona.systemPrompt,
          userText,
          false,
          currentConfig.aiSettings.temperature ?? 0.7,
        ),
        () => '嗯，我在。',
      );
      this.emotionState = currentEmotionState;
      await this.persistMessages(userId, userText, text);
      return { text, emotionState: currentEmotionState };
    } catch (error: any) {
      console.error('[AIEngine] Error:', error);
      if (error instanceof AIRequestError) throw error;
      throw new AIRequestError(error?.message || 'AI request failed', { cause: error });
    }
  }

  private async persistMessages(userId: string | undefined, userText: string, responseText: string): Promise<void> {
    if (!userId) return;

    try {
      await firebaseService.saveMessage(userId, { role: 'user', content: userText });
      await firebaseService.saveMessage(userId, { role: 'assistant', content: responseText });
    } catch (error) {
      console.error('Failed to save messages to Firestore:', error);
    }
  }
}
