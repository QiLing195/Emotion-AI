// Export AI Engine
export { DefaultAIEngine } from './aiEngine';

// Export AI Coordinator (v4.1 — 新模块编排)
export { AICoordinator, aiCoordinator } from './aiCoordinator';
export type { TurnInput, TurnOutput, TurnMetadata } from './aiCoordinator';

// Export channels
export { WeChatOfficialAccountChannel } from './channels/wechat';

// Export providers
export { MockIoTProvider } from './providers/mockIoT';

// Export services
export { mcpService } from './mcpService';
export { firebaseService } from './firebase';

// Export utilities
export { extractJSON } from '../utils/index';
export { ALLOWED_MCP_TOOLS, isToolAllowed } from './mcp';