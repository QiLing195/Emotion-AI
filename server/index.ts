import 'dotenv/config';
import AIGirlfriendServer from './server.js';

const PORT = parseInt(process.env.PORT || '3000', 10);

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