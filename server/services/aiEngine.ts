import { EmotionState, INITIAL_EMOTION_STATE, EmotionEvent } from '../../src/lib/emotionEngine.js';
import { applyEvent, buildEmotionUpdatedPayload } from '../../src/lib/stateReducer.js';
import { generateAIResponse, generateAIChatResponse, AISettings } from '../../src/lib/aiProvider.js';
import { extractJSON } from '../utils/index.js';
import { firebaseService } from './firebase.js';

export interface ChatResponse {
  text: string;
  emotionEvent?: EmotionEvent;
}

export interface ClientContext {
  clientSystemPrompt?: string;
  clientSettings?: any;
  persona?: any;
  recentMessages?: { role: string; content: string; imageUrl?: string }[];
}

export class DefaultAIEngine {
  private config: any = null;
  emotionState: EmotionState = INITIAL_EMOTION_STATE;

  setConfig(config: any) {
    this.config = config;
    if (config.persona && config.persona.emotionState) {
      this.emotionState = config.persona.emotionState;
    }
  }

  private async evaluateEmotionEvent(userMsg: string, aiSettings: any): Promise<EmotionEvent | null> {
    try {
      const prompt = `
分析用户的输入，提取情感事件参数。
返回 JSON 格式：
{
  "deltaA": number, // 接近意愿变化 [-0.5, 0.5] (正数表示更想接近，负数表示想远离)
  "deltaB": number, // 逃避意愿变化 [-0.5, 0.5] (正数表示更想逃避，负数表示不想逃避)
  "deltaR": number, // 理性程度变化 [-0.5, 0.5] (正数表示更理性，负数表示更感性)
  "intent": "user" | "self" | "third_party", // 意图来源
  "GC": number, // 目标一致性 [-1, 1] (正数表示符合AI目标，负数表示阻碍)
  "agency": number, // 责任归属 [-1, 1] (1=AI自己，-1=用户)
  "fairness": number, // 公平性 [-1, 1]
  "control": number // 控制感 [-1, 1]
}

用户输入: "${userMsg}"
`;

      const responseContent = await generateAIResponse(
        aiSettings,
        "你是一个情感分析引擎，负责提取用户输入中的情感事件参数。",
        prompt,
        true,
        0.7
      );

      const parsed = extractJSON(responseContent || '{}');

      if (parsed && typeof parsed.deltaA === 'number') {
        return parsed as EmotionEvent;
      }
      return null;
    } catch (error) {
      console.error('Emotion evaluation failed:', error);
      return null;
    }
  }

  async generateResponse(userText: string, userId?: string, clientContext?: ClientContext): Promise<ChatResponse> {
    let currentConfig = this.config;
    let currentEmotionState = this.emotionState;
    let computedEvent: EmotionEvent | null = null;
    let systemPrompt: string;

    // ── PATH 1: Client-provided context (preferred) ──
    if (clientContext?.clientSystemPrompt) {
      systemPrompt = clientContext.clientSystemPrompt;
      const aiSettings = clientContext.clientSettings as AISettings;

      // Emotion evaluation still runs server-side to update internal state and return the event
      if (clientContext.persona?.dynamicEmotion && aiSettings) {
        const event = await this.evaluateEmotionEvent(userText, aiSettings);
        computedEvent = event;
        if (event) {
          // v1.0: 走 applyEvent — 服务端情感变更可回放
          currentEmotionState = applyEvent(currentEmotionState, {
            id: '', type: 'EmotionUpdated', level: 'cognitive', source: 'emotion',
            timestamp: Date.now(),
            data: buildEmotionUpdatedPayload({
              stimulus: event,
              context: {
                baseA: clientContext.persona.optimism / 100,
                baseB: (100 - clientContext.persona.optimism) / 100,
                baseR: clientContext.persona.independence / 100,
                emotionalStability: Math.max(0.1, Math.min(0.9,
                  (100 - clientContext.persona.expressiveness) / 100 - 0.05)),
                empathy: clientContext.persona.empathy,
                optimism: clientContext.persona.optimism,
              },
            }),
          });
          this.emotionState = currentEmotionState;

          if (userId) {
            try {
              await firebaseService.saveUserData(userId, { emotionState: currentEmotionState });
            } catch (error) {
              console.error('Failed to save emotion state to Firestore:', error);
            }
          }
        }
      }

      // LLM call with client's systemPrompt (already contains emotion context)
      let aiResponseText = '';
      try {
        if (clientContext.recentMessages && clientContext.recentMessages.length > 0) {
          const result = await generateAIChatResponse(
            aiSettings,
            systemPrompt,
            clientContext.recentMessages as { role: 'user' | 'assistant'; content: string; imageUrl?: string }[],
            false,
            aiSettings.temperature ?? 0.7
          );
          aiResponseText = result.text;
        } else {
          aiResponseText = await generateAIResponse(
            aiSettings,
            systemPrompt,
            userText,
            false,
            aiSettings.temperature ?? 0.7
          );
        }

        if (userId) {
          try {
            await firebaseService.saveMessage(userId, { role: 'user', content: userText });
            await firebaseService.saveMessage(userId, { role: 'assistant', content: aiResponseText });
          } catch (error) {
            console.error('Failed to save messages to Firestore:', error);
          }
        }

        return { text: aiResponseText, emotionEvent: computedEvent ?? undefined };
      } catch (error: any) {
        console.error('[AIEngine] Error:', error);
        return { text: `AI 请求失败: ${error.message}` };
      }
    }

    // ── PATH 2: Server-side config (legacy / no client context) ──
    if (userId) {
      try {
        const userData = await firebaseService.getUserData(userId);
        if (userData?.config) currentConfig = userData.config;
        if (userData?.emotionState) currentEmotionState = userData.emotionState;
      } catch (error) {
        console.error('Failed to load user data from Firestore:', error);
      }
    }

    if (!currentConfig || !currentConfig.aiSettings || !currentConfig.persona) {
      return { text: '抱歉，家庭管家尚未配置完成。请在网页端保存配置。' };
    }

    const { temperature } = currentConfig.aiSettings;
    systemPrompt = currentConfig.persona.systemPrompt;

    if (currentConfig.persona.dynamicEmotion) {
      const event = await this.evaluateEmotionEvent(userText, currentConfig.aiSettings);
      computedEvent = event;
      if (event) {
        // v1.0: 走 applyEvent — 服务端情感变更可回放
        currentEmotionState = applyEvent(currentEmotionState, {
          id: '', type: 'EmotionUpdated', level: 'cognitive', source: 'emotion',
          timestamp: Date.now(),
          data: buildEmotionUpdatedPayload({
            stimulus: event,
            context: {
              baseA: currentConfig.persona.optimism / 100,
              baseB: (100 - currentConfig.persona.optimism) / 100,
              baseR: currentConfig.persona.independence / 100,
              emotionalStability: Math.max(0.1, Math.min(0.9,
                (100 - currentConfig.persona.expressiveness) / 100 - 0.05)),
              empathy: currentConfig.persona.empathy,
              optimism: currentConfig.persona.optimism,
            },
          }),
        });

        this.emotionState = currentEmotionState;

        if (userId) {
          try { await firebaseService.saveUserData(userId, { emotionState: currentEmotionState }); } catch (e) {}
        }
      }
    }

    try {
      const aiResponseText = await generateAIResponse(currentConfig.aiSettings, systemPrompt, userText, false, temperature);

      if (userId) {
        try {
          await firebaseService.saveMessage(userId, { role: 'user', content: userText });
          await firebaseService.saveMessage(userId, { role: 'assistant', content: aiResponseText });
        } catch (e) {}
      }

      return { text: aiResponseText, emotionEvent: computedEvent ?? undefined };
    } catch (error: any) {
      console.error('[AIEngine] Error:', error);
      return { text: `AI 请求失败: ${error.message}` };
    }
  }
}
