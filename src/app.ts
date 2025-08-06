import express from 'express';
import cors from 'cors';
import { QueueService } from './services/queue.service';
import { createLabResultsRoutes } from './routes/labResults.routes';
import { logger } from './utils/logger';

export function createApp(queueService: QueueService): express.Application {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Routes
  app.use('/api', createLabResultsRoutes(queueService));

  // 404 handler
  app.use('*', (req, res) => {
    res.status(404).json({
      success: false,
      error: 'Route not found',
    });
  });

  // Error handler
  app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error('Unhandled error', {
      error: err.message,
      stack: err.stack,
      url: req.url,
      method: req.method,
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  });

  return app;
}