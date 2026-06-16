import { Application } from 'express';
import { EmotionEvent, EmotionState } from '../../src/lib/emotionEngine.js';
import { ClientContext } from './aiEngine.js';

export interface ChatResponse {
  text: string;
  emotionEvent?: EmotionEvent;
}

export interface IAIEngine {
  emotionState: EmotionState;
  setConfig(config: any): void;
  generateResponse(userText: string, userId?: string, clientContext?: ClientContext): Promise<ChatResponse>;
}

export interface IMessageChannel {
  id: string;
  name: string;
  registerRoutes(app: Application, aiEngine: IAIEngine): void;
  setConfig(config: any): void;
}

export interface IIoTProvider {
  id: string;
  name: string;
  toggleDevice(deviceId: string, status: 'on' | 'off'): Promise<{ success: boolean; message?: string }>;
}