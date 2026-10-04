import 'dotenv/config';
import AIGirlfriendServer from './server.js';
import { setBaselineDecayEnabled } from '../src/lib/emotionTimeDecay.js';

const PORT = parseInt(process.env.PORT || '3000', 10);

// v1.24：九情的时间衰减默认**回归各自的静息基线**（此前衰减到 0，与 activation 层的基线冲突）。
// `DISABLE_BASELINE_DECAY=true` 回到旧行为，仅供 A/B 对照与回退。
// 在进程入口设置而不是写模块级 env 常量：前端 store 也调用 processTimeDecay，浏览器读不到 env，
// 保持默认值即可，两边行为一致。
setBaselineDecayEnabled(process.env.DISABLE_BASELINE_DECAY !== 'true');

async function startServer() {
  try {
    console.log('Starting AI Girlfriend Server...');

    const server = new AIGirlfriendServer();
    await server.start(PORT);

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\nReceived SIGINT, shutting down gracefully...');
      await server.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\nReceived SIGTERM, shutting down gracefully...');
      await server.stop();
      process.exit(0);
    });

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();