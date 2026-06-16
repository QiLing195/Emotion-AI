/**
 * Main type exports for the AI Girlfriend application
 * Re-exports from store and data modules, plus shared UI types
 */

// Re-export store types
export type {
  Provider,
  Persona,
  Preset,
  TTSSettings,
  Settings,
  ChatMessage,
} from '../store/useAIBrainStore';

// Re-export data types
export type {
  Device,
  Memory,
  Log,
} from '../data/mockData';

// Emotion types from emotionEngine
export type { EmotionState, EmotionEvent } from '../lib/emotionEngine';

// UI-specific types
export type {
  ButtonVariant,
  ButtonSize,
  CardVariant,
  InputVariant,
  ToggleSize,
  SelectOption,
} from './ui';

// Helper types
export type Nullable<T> = T | null;
export type Optional<T> = T | undefined;
export type Maybe<T> = T | null | undefined;