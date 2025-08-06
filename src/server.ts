import { createApp } from './app';
import { QueueService } from './services/queue.service';
import { config } from './config';
import { logger } from './utils/logger';

async function startServer(): Promise<void> {
  try {
    const queueService = new QueueService();
    const app = createApp(queueService);

    const server = app.listen(config.port, () => {
      logger.info('Server started', {
        port: config.port,
        nodeEnv: config.nodeEnv,
      });
    });

    // Graceful shutdown
    const gracefulShutdown = async (signal: string) => {
      logger.info(`Received ${signal}. Starting graceful shutdown...`);
      
      server.close(async () => {
        logger.info('HTTP server closed');
        
        try {
          await queueService.close();
          logger.info('Queue service closed');
          process.exit(0);
        } catch (error) {
          logger.error('Error during shutdown', {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          process.exit(1);
        }
      });
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error) {
    logger.error('Failed to start server', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

export { startServer };