import cluster from 'cluster';
import os from 'os';
import { createApp } from './app';
import { QueueService } from './services/queue.service';
import { config } from './config';
import { logger } from './utils/logger';

// Configuración de clusters
const CLUSTER_ENABLED = process.env.CLUSTER_ENABLED === 'true' || config.nodeEnv === 'production';
const WORKER_COUNT = parseInt(process.env.WORKER_COUNT || '0') || os.cpus().length;

logger.debug(`Cpus avalible ${os.cpus().length}`)
logger.debug(`Cluster workers ${WORKER_COUNT}`)

async function startWorker(): Promise<void> {
  try {
    const queueService = new QueueService();
    const app = createApp(queueService);
    
    const server = app.listen(config.port, () => {
      logger.info('Cluster worker started', {
        pid: process.pid,
        port: config.port,
        nodeEnv: config.nodeEnv,
      });
    });

    // Graceful shutdown para workers
    const gracefulShutdown = async (signal: string) => {
      logger.info(`Cluster worker ${process.pid} received ${signal}. Starting graceful shutdown...`);
      
      server.close(async () => {
        logger.info(`Cluster worker ${process.pid} HTTP server closed`);
        try {
          await queueService.close();
          logger.info(`Cluster worker ${process.pid} queue service closed`);
          process.exit(0);
        } catch (error) {
          logger.error(`Cluster worker ${process.pid} error during shutdown`, {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          process.exit(1);
        }
      });
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    
  } catch (error) {
    logger.error(`Cluster worker ${process.pid} failed to start`, {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    process.exit(1);
  }
}

async function startMaster(): Promise<void> {
  logger.info('Starting cluster master', {
    workers: WORKER_COUNT,
    pid: process.pid,
  });

  // Crear workers
  for (let i = 0; i < WORKER_COUNT; i++) {
    cluster.fork();
  }

  // Manejar workers que se desconectan
  cluster.on('exit', (worker, code, signal) => {
    logger.warn('Worker died', {
      pid: worker.process.pid,
      code,
      signal,
    });

    // Reiniciar worker si no fue una salida intencional
    if (code !== 0 && !worker.exitedAfterDisconnect) {
      logger.info('Starting new worker...');
      cluster.fork();
    }
  });

  // Manejar errores de workers
  cluster.on('disconnect', (worker) => {
    logger.info('Worker disconnected', {
      pid: worker.process.pid,
    });
  });

  // Graceful shutdown para el master
  const gracefulShutdown = async (signal: string) => {
    logger.info(`Master received ${signal}. Starting graceful shutdown...`);
    
    // Desconectar todos los workers
    for (const id in cluster.workers) {
      const worker = cluster.workers[id];
      if (worker) {
        worker.kill('SIGTERM');
      }
    }

    // Esperar a que todos los workers terminen
    const shutdownTimeout = setTimeout(() => {
      logger.warn('Forcing shutdown after timeout');
      process.exit(1);
    }, 30000); // 30 segundos timeout

    cluster.on('exit', () => {
      const runningWorkers = Object.keys(cluster.workers || {}).length;
      if (runningWorkers === 0) {
        clearTimeout(shutdownTimeout);
        logger.info('All workers shut down. Master exiting.');
        process.exit(0);
      }
    });
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

async function startServer(): Promise<void> {
  if (CLUSTER_ENABLED && cluster.isPrimary) {
    await startMaster();
  } else {
    await startWorker();
  }
}

// Solo ejecutar si es el módulo principal
if (require.main === module) {
  startServer();
}

export { startServer, startWorker, startMaster };