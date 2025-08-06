import { Queue, Worker, Job } from 'bullmq';
import { Redis, RedisOptions } from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { LabResult, ProcessedLabResult, JobStats } from '../types/labResult';
import { config } from '../config';
import { logger } from '../utils/logger';

export class QueueService {
    private redis: Redis;
    private labResultQueue: Queue;
    private deadLetterQueue: Queue;
    private worker: Worker;

    constructor() {
        const redisOptions: RedisOptions = {
            maxRetriesPerRequest: null,
            retryStrategy: function (times) {
                return Math.min(times * 50, 2000);
            },
            reconnectOnError: (err) => {
                logger.error('Redis connection error', { error: err.message });
                return true;
            }
        };
        // Initialize Redis connection
        this.redis = new Redis(config.redis.url, redisOptions);

        // Initialize queues
        this.labResultQueue = new Queue('lab-results', {
            connection: this.redis,
            defaultJobOptions: {
                attempts: config.queue.maxRetries,
                backoff: {
                    type: 'exponential',
                    delay: config.queue.jobDelay,
                },
                removeOnComplete: 100,
                removeOnFail: 50,
            },
        });

        this.deadLetterQueue = new Queue('dead-letter', {
            connection: this.redis,
            defaultJobOptions: {
                removeOnComplete: 1000,
                removeOnFail: 1000,
            },
        });

        // Initialize worker
        this.worker = new Worker(
            'lab-results',
            this.processLabResult.bind(this),
            {
                connection: this.redis,
                concurrency: 5,
            }
        );

        this.setupEventHandlers();
    }

    private setupEventHandlers(): void {
        this.worker.on('completed', (job: Job) => {
            logger.info('Job completed successfully', {
                jobId: job.id,
                patientId: job.data.patientId,
                attempts: job.attemptsMade,
            });
        });

        this.worker.on('failed', async (job: Job | undefined, err: Error) => {
            if (!job) {
              logger.error('Job failed but job object is undefined', { error: err.message });
              return;
            }
          
            logger.error('Job failed', {
              jobId: job.id,
              patientId: job.data.patientId,
              attemptsMade: job.attemptsMade + 1, // +1 porque es 0-indexed
              maxRetries: config.queue.maxRetries,
              error: err.message,
            });
          
            // Verificar si este es el último intento (attemptsMade es 0-indexed)
            if (job.attemptsMade + 1 >= config.queue.maxRetries) {
              await this.moveToDeadLetter(job, err);
            }
        });

        this.worker.on('error', (err: Error) => {
            logger.error('Worker error', { error: err.message });
        });
    }

    async addLabResult(labResult: LabResult): Promise<string> {
        const jobId = uuidv4();
        const processedLabResult: ProcessedLabResult = {
            ...labResult,
            id: jobId,
            status: 'pending',
            attempts: 0,
            errors: [],
        };

        await this.labResultQueue.add('process-lab-result', processedLabResult, {
            jobId,
        });

        logger.info('Job received ', {
            jobId,
            patientId: labResult.patientId,
            labType: labResult.labType,
        });

        return jobId;
    }

    private async processLabResult(job: Job<ProcessedLabResult>): Promise<void> {
        const { id, patientId, labType, result } = job.data;

        logger.info('Job started', {
            jobId: id,
            patientId,
            labType,
            attempt: job.attemptsMade + 1,
        });

        try {
            // Simulate processing delay
            await this.delay(config.queue.processingDelay);

            // Simulate random failures (30% chance)
            if (Math.random() < 0.3) {
                throw new Error('Simulated transient processing error');
            }

            // Simulate actual lab result processing
            await this.simulateLabProcessing(job.data);

            logger.info('Success', {
                jobId: id,
                patientId,
                labType,
                result,
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';

            logger.error('Retry attempts', {
                jobId: id,
                patientId,
                attempt: job.attemptsMade + 1,
                error: errorMessage,
            });

            throw error;
        }
    }

    private async simulateLabProcessing(labResult: ProcessedLabResult): Promise<void> {
        // Simulate complex lab result processing
        const steps = [
            'Validating patient data',
            'Processing lab result',
            'Running quality checks',
            'Updating patient records',
            'Generating reports',
        ];

        for (const step of steps) {
            await this.delay(100);
            logger.debug(`Processing step ${step} completed for patient ${labResult.patientId}`);
        }
    }

    private async moveToDeadLetter(job: Job, error: Error): Promise<void> {
        const deadLetterData = {
            ...job.data,
            status: 'dead' as const,
            finalError: error.message,
            deadLetteredAt: new Date().toISOString(),
        };

        await this.deadLetterQueue.add('dead-letter-job', deadLetterData);

        logger.error('Dead-lettered job ', {
            jobId: job.id,
            patientId: job.data.patientId,
            finalError: error.message,
        });
    }

    async getQueueStats(): Promise<JobStats> {
        const waiting = await this.labResultQueue.getWaiting();
        const active = await this.labResultQueue.getActive();
        const completed = await this.labResultQueue.getCompleted();
        const failed = await this.labResultQueue.getFailed();
        const delayed = await this.labResultQueue.getDelayed();

        return {
            waiting: waiting.length,
            active: active.length,
            completed: completed.length,
            failed: failed.length,
            delayed: delayed.length,
        };
    }

    async getDeadLetterCount(): Promise<number> {
        const [waiting, active, completed] = await Promise.all([
          this.deadLetterQueue.getWaiting(),
          this.deadLetterQueue.getActive(),
          this.deadLetterQueue.getCompleted()
        ]);
        return waiting.length + active.length + completed.length;
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async close(): Promise<void> {
        await this.worker.close();
        await this.labResultQueue.close();
        await this.deadLetterQueue.close();
        await this.redis.disconnect();
    }
}