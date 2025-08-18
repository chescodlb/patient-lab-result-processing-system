import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  // Configuración de clusters
  cluster: {
    enabled: process.env.CLUSTER_ENABLED === 'true' || process.env.NODE_ENV === 'production',
    workerCount: parseInt(process.env.WORKER_COUNT || '1') || require('os').cpus().length,
    shutdownTimeout: parseInt(process.env.SHUTDOWN_TIMEOUT || '30000'), // 30 segundos
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
  queue: {
    maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),
    jobDelay: parseInt(process.env.JOB_DELAY || '1000', 10),
    processingDelay: parseInt(process.env.PROCESSING_DELAY || '2000', 10),
  },
  nodeEnv: process.env.NODE_ENV || 'development',
} as const;