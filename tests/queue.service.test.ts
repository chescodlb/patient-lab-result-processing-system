// src/__tests__/queue.service.test.ts
import { QueueService } from '../src/services/queue.service';
import { Queue, Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { LabResult, ProcessedLabResult } from '../src/types/labResult';
import { config } from '../src/config';
import { logger } from '../src/utils/logger';

// Mock dependencies
jest.mock('bullmq');
jest.mock('ioredis');
jest.mock('../src/utils/logger');
jest.mock('../src/config', () => ({
  config: {
    redis: { url: 'redis://localhost:6379' },
    queue: {
      maxRetries: 3,
      jobDelay: 1000,
      processingDelay: 2000,
    },
  },
}));

// Type mocks
const MockedRedis = Redis as unknown as  jest.MockedObject<typeof Redis>;
const MockedQueue = Queue as unknown as  jest.MockedObject<typeof Queue>;
const MockedWorker = Worker as unknown as jest.MockedObject<typeof Worker>;
const mockedLogger = logger as jest.MockedObject<typeof logger>;

describe('QueueService', () => {
  let queueService: QueueService;
  let mockRedis: jest.MockedObject<Redis>;
  let mockLabResultQueue: jest.MockedObject<Queue>;
  let mockDeadLetterQueue: jest.MockedObject<Queue>;
  let mockWorker: jest.MockedObject<Worker>;

  // Test data
  const sampleLabResult: LabResult = {
    patientId: 'patient-123',
    labType: 'blood',
    result: 'positive',
    receivedAt: '2025-07-08T10:00:00Z',
  };

  const sampleProcessedLabResult: ProcessedLabResult = {
    ...sampleLabResult,
    id: 'job-123',
    status: 'pending',
    attempts: 0,
    errors: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock Redis instance
    mockRedis = {
      disconnect: jest.fn().mockResolvedValue(undefined),
    } as any;
    MockedRedis.mockImplementation(() => mockRedis);

    // Mock Queue instances
    mockLabResultQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job-123' }),
      getWaiting: jest.fn().mockResolvedValue([]),
      getActive: jest.fn().mockResolvedValue([]),
      getCompleted: jest.fn().mockResolvedValue([]),
      getFailed: jest.fn().mockResolvedValue([]),
      getDelayed: jest.fn().mockResolvedValue([]),
      close: jest.fn().mockResolvedValue(undefined),
    } as any;

    mockDeadLetterQueue = {
      add: jest.fn().mockResolvedValue({ id: 'dead-job-123' }),
      getCompleted: jest.fn().mockResolvedValue([]),
      close: jest.fn().mockResolvedValue(undefined),
    } as any;

    // Mock Worker instance
    mockWorker = {
      on: jest.fn().mockReturnThis(),
      close: jest.fn().mockResolvedValue(undefined),
    } as any;

    // Setup Queue constructor mocks
    MockedQueue.mockImplementation((name: string) => {
      if (name === 'lab-results') {
        return mockLabResultQueue;
      } else if (name === 'dead-letter') {
        return mockDeadLetterQueue;
      }
      throw new Error(`Unexpected queue name: ${name}`);
    });

    // Setup Worker constructor mock
    MockedWorker.mockImplementation(() => mockWorker);

    // Create service instance
    queueService = new QueueService();
  });

  afterEach(async () => {
    if (queueService) {
      await queueService.close();
    }
  });

  describe('Constructor and Initialization', () => {
    it('should initialize Redis connection with correct configuration', () => {
      expect(MockedRedis).toHaveBeenCalledWith(config.redis.url, {
        maxRetriesPerRequest: 3,
        retryDelayOnFailover: 100,
      });
    });

    it('should initialize lab results queue with correct options', () => {
      expect(MockedQueue).toHaveBeenCalledWith('lab-results', {
        connection: mockRedis,
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
    });

    it('should initialize dead letter queue', () => {
      expect(MockedQueue).toHaveBeenCalledWith('dead-letter', {
        connection: mockRedis,
        defaultJobOptions: {
          removeOnComplete: 1000,
          removeOnFail: 1000,
        },
      });
    });

    it('should initialize worker with correct configuration', () => {
      expect(MockedWorker).toHaveBeenCalledWith(
        'lab-results',
        expect.any(Function),
        {
          connection: mockRedis,
          concurrency: 5,
        }
      );
    });

    it('should setup event handlers for worker', () => {
      expect(mockWorker.on).toHaveBeenCalledWith('completed', expect.any(Function));
      expect(mockWorker.on).toHaveBeenCalledWith('failed', expect.any(Function));
      expect(mockWorker.on).toHaveBeenCalledWith('error', expect.any(Function));
    });
  });

  describe('addLabResult', () => {
    it('should add job to queue with generated UUID', async () => {
      const jobId = await queueService.addLabResult(sampleLabResult);

      expect(typeof jobId).toBe('string');
      expect(jobId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      
      expect(mockLabResultQueue.add).toHaveBeenCalledWith(
        'process-lab-result',
        expect.objectContaining({
          ...sampleLabResult,
          id: jobId,
          status: 'pending',
          attempts: 0,
          errors: [],
        }),
        { jobId }
      );
    });

    it('should log job addition', async () => {
      const jobId = await queueService.addLabResult(sampleLabResult);

      expect(mockedLogger.info).toHaveBeenCalledWith(
        'Job added to queue',
        {
          jobId,
          patientId: sampleLabResult.patientId,
          labType: sampleLabResult.labType,
        }
      );
    });
  });

  describe('Event Handlers', () => {
    let completedHandler: Function;
    let failedHandler: Function;
    let errorHandler: Function;

    beforeEach(() => {
      // Extract the event handlers that were registered
      const onCalls = (mockWorker.on as jest.Mock).mock.calls;
      completedHandler = onCalls.find(call => call[0] === 'completed')[1];
      failedHandler = onCalls.find(call => call[0] === 'failed')[1];
      errorHandler = onCalls.find(call => call[0] === 'error')[1];
    });

    describe('completed handler', () => {
      it('should log successful job completion', () => {
        const mockJob = {
          id: 'job-123',
          data: { patientId: 'patient-123' },
          attemptsMade: 1,
        };

        completedHandler(mockJob);

        expect(mockedLogger.info).toHaveBeenCalledWith(
          'Job completed successfully',
          {
            jobId: mockJob.id,
            patientId: mockJob.data.patientId,
            attempts: mockJob.attemptsMade,
          }
        );
      });
    });

    describe('failed handler', () => {
      it('should log job failure', async () => {
        const mockJob = {
          id: 'job-123',
          data: { patientId: 'patient-123' },
          attemptsMade: 1,
        };
        const mockError = new Error('Processing failed');

        await failedHandler(mockJob, mockError);

        expect(mockedLogger.error).toHaveBeenCalledWith(
          'Job failed',
          {
            jobId: mockJob.id,
            patientId: mockJob.data.patientId,
            attempts: mockJob.attemptsMade,
            error: mockError.message,
          }
        );
      });

      it('should move job to dead letter queue after max retries', async () => {
        const mockJob = {
          id: 'job-123',
          data: sampleProcessedLabResult,
          attemptsMade: 3, // Max retries reached
        };
        const mockError = new Error('Final failure');

        await failedHandler(mockJob, mockError);

        expect(mockDeadLetterQueue.add).toHaveBeenCalledWith(
          'dead-letter-job',
          expect.objectContaining({
            ...mockJob.data,
            status: 'dead',
            finalError: mockError.message,
            deadLetteredAt: expect.any(String),
          })
        );

        expect(mockedLogger.error).toHaveBeenCalledWith(
          'Job moved to dead letter queue',
          {
            jobId: mockJob.id,
            patientId: mockJob.data.patientId,
            finalError: mockError.message,
          }
        );
      });

      it('should NOT move job to dead letter queue if under max retries', async () => {
        const mockJob = {
          id: 'job-123',
          data: sampleProcessedLabResult,
          attemptsMade: 2, // Under max retries
        };
        const mockError = new Error('Transient failure');

        await failedHandler(mockJob, mockError);

        expect(mockDeadLetterQueue.add).not.toHaveBeenCalled();
      });

      it('should handle undefined job gracefully', async () => {
        const mockError = new Error('Job is undefined');

        await failedHandler(undefined, mockError);

        expect(mockedLogger.error).toHaveBeenCalledWith(
          'Job failed but job object is undefined',
          { error: mockError.message }
        );

        expect(mockDeadLetterQueue.add).not.toHaveBeenCalled();
      });
    });

    describe('error handler', () => {
      it('should log worker errors', () => {
        const mockError = new Error('Worker connection failed');

        errorHandler(mockError);

        expect(mockedLogger.error).toHaveBeenCalledWith(
          'Worker error',
          { error: mockError.message }
        );
      });
    });
  });

  describe('processLabResult', () => {
    let processLabResult: Function;

    beforeEach(() => {
      // Access the private method through reflection for testing
      processLabResult = (queueService as any).processLabResult.bind(queueService);
      
      // Mock Math.random to control failure simulation
      jest.spyOn(Math, 'random');
      
      // Mock delay method
      jest.spyOn(queueService as any, 'delay').mockResolvedValue(undefined);
    });

    afterEach(() => {
      (Math.random as jest.Mock).mockRestore();
    });

    it('should process job successfully when no random failure occurs', async () => {
      (Math.random as jest.Mock).mockReturnValue(0.5); // > 0.3, no failure

      const mockJob = {
        id: 'job-123',
        data: sampleProcessedLabResult,
        attemptsMade: 0,
      };

      await expect(processLabResult(mockJob)).resolves.not.toThrow();

      expect(mockedLogger.info).toHaveBeenCalledWith(
        'Job processing started',
        {
          jobId: mockJob.data.id,
          patientId: mockJob.data.patientId,
          labType: mockJob.data.labType,
          attempt: mockJob.attemptsMade + 1,
        }
      );

      expect(mockedLogger.info).toHaveBeenCalledWith(
        'Lab result processed successfully',
        {
          jobId: mockJob.data.id,
          patientId: mockJob.data.patientId,
          labType: mockJob.data.labType,
          result: mockJob.data.result,
        }
      );
    });

    it('should throw error when random failure occurs', async () => {
      (Math.random as jest.Mock).mockReturnValue(0.2); // < 0.3, simulate failure

      const mockJob = {
        id: 'job-123',
        data: sampleProcessedLabResult,
        attemptsMade: 1,
      };

      await expect(processLabResult(mockJob)).rejects.toThrow('Simulated transient processing error');

      expect(mockedLogger.error).toHaveBeenCalledWith(
        'Lab result processing failed',
        {
          jobId: mockJob.data.id,
          patientId: mockJob.data.patientId,
          attempt: mockJob.attemptsMade + 1,
          error: 'Simulated transient processing error',
        }
      );
    });

    it('should handle processing delays', async () => {
      (Math.random as jest.Mock).mockReturnValue(0.5); // No failure
      const delaySpy = jest.spyOn(queueService as any, 'delay');

      const mockJob = {
        id: 'job-123',
        data: sampleProcessedLabResult,
        attemptsMade: 0,
      };

      await processLabResult(mockJob);

      // Should call delay for processing delay + simulation steps
      expect(delaySpy).toHaveBeenCalledWith(config.queue.processingDelay);
      expect(delaySpy).toHaveBeenCalledWith(100); // Step delays in simulation
    });
  });

  describe('Retry Logic Integration', () => {
    it('should be configured for exactly 3 retry attempts', () => {
      expect(MockedQueue).toHaveBeenCalledWith(
        'lab-results',
        expect.objectContaining({
          defaultJobOptions: expect.objectContaining({
            attempts: 3,
          }),
        })
      );
    });

    it('should use exponential backoff for retries', () => {
      expect(MockedQueue).toHaveBeenCalledWith(
        'lab-results',
        expect.objectContaining({
          defaultJobOptions: expect.objectContaining({
            backoff: {
              type: 'exponential',
              delay: config.queue.jobDelay,
            },
          }),
        })
      );
    });

    it('should move job to dead letter queue only after exactly 3 failed attempts', async () => {
      const failedHandler = (mockWorker.on as jest.Mock).mock.calls
        .find(call => call[0] === 'failed')[1];

      const mockJob = {
        id: 'job-123',
        data: sampleProcessedLabResult,
        attemptsMade: 3, // Exactly max retries
      };
      const mockError = new Error('Final failure');

      await failedHandler(mockJob, mockError);

      expect(mockDeadLetterQueue.add).toHaveBeenCalledTimes(1);
    });

    it('should NOT move job to dead letter queue after 2 failed attempts', async () => {
      const failedHandler = (mockWorker.on as jest.Mock).mock.calls
        .find(call => call[0] === 'failed')[1];

      const mockJob = {
        id: 'job-123',
        data: sampleProcessedLabResult,
        attemptsMade: 2, // Less than max retries
      };
      const mockError = new Error('Transient failure');

      await failedHandler(mockJob, mockError);

      expect(mockDeadLetterQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('getQueueStats', () => {
    it('should return queue statistics from all queue states', async () => {
      const mockWaiting = [{ id: '1' }, { id: '2' }];
      const mockActive = [{ id: '3' }];
      const mockCompleted = [{ id: '4' }, { id: '5' }, { id: '6' }];
      const mockFailed = [{ id: '7' }];
      const mockDelayed = [{ id: '8' }, { id: '9' }];

      mockLabResultQueue.getWaiting.mockResolvedValue(mockWaiting as any);
      mockLabResultQueue.getActive.mockResolvedValue(mockActive as any);
      mockLabResultQueue.getCompleted.mockResolvedValue(mockCompleted as any);
      mockLabResultQueue.getFailed.mockResolvedValue(mockFailed as any);
      mockLabResultQueue.getDelayed.mockResolvedValue(mockDelayed as any);

      const stats = await queueService.getQueueStats();

      expect(stats).toEqual({
        waiting: 2,
        active: 1,
        completed: 3,
        failed: 1,
        delayed: 2,
      });
    });
  });

  describe('getDeadLetterCount', () => {
    it('should return count of jobs in dead letter queue', async () => {
      const mockDeadJobs = [{ id: '1' }, { id: '2' }, { id: '3' }];
      mockDeadLetterQueue.getCompleted.mockResolvedValue(mockDeadJobs as any);

      const count = await queueService.getDeadLetterCount();

      expect(count).toBe(3);
    });
  });

  describe('close', () => {
    it('should close all connections properly', async () => {
      await queueService.close();

      expect(mockWorker.close).toHaveBeenCalledTimes(1);
      expect(mockLabResultQueue.close).toHaveBeenCalledTimes(1);
      expect(mockDeadLetterQueue.close).toHaveBeenCalledTimes(1);
      expect(mockRedis.disconnect).toHaveBeenCalledTimes(1);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle queue add failures gracefully', async () => {
      const error = new Error('Redis connection failed');
      mockLabResultQueue.add.mockRejectedValue(error);

      await expect(queueService.addLabResult(sampleLabResult)).rejects.toThrow(error);
    });

    it('should handle stats retrieval failures', async () => {
      const error = new Error('Queue stats unavailable');
      mockLabResultQueue.getWaiting.mockRejectedValue(error);

      await expect(queueService.getQueueStats()).rejects.toThrow(error);
    });

    it('should handle dead letter count failures', async () => {
      const error = new Error('Dead letter queue unavailable');
      mockDeadLetterQueue.getCompleted.mockRejectedValue(error);

      await expect(queueService.getDeadLetterCount()).rejects.toThrow(error);
    });
  });

  describe('Dead Letter Queue Functionality', () => {
    let failedHandler: Function;

    beforeEach(() => {
      failedHandler = (mockWorker.on as jest.Mock).mock.calls
        .find(call => call[0] === 'failed')[1];
    });

    it('should add proper dead letter data structure', async () => {
      const mockJob = {
        id: 'job-123',
        data: sampleProcessedLabResult,
        attemptsMade: 3,
      };
      const mockError = new Error('Unrecoverable error');

      await failedHandler(mockJob, mockError);

      expect(mockDeadLetterQueue.add).toHaveBeenCalledWith(
        'dead-letter-job',
        expect.objectContaining({
          ...mockJob.data,
          status: 'dead',
          finalError: 'Unrecoverable error',
          deadLetteredAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/),
        })
      );
    });

    it('should preserve original job data in dead letter queue', async () => {
      const complexLabResult = {
        ...sampleProcessedLabResult,
        id: 'complex-job',
        patientId: 'patient-456',
        labType: 'genetic' as const,
        result: 'complex result with special chars: @#$%',
        receivedAt: '2025-07-08T15:30:00Z',
        attempts: 2,
        errors: ['previous error 1', 'previous error 2'],
      };

      const mockJob = {
        id: 'complex-job',
        data: complexLabResult,
        attemptsMade: 3,
      };
      const mockError = new Error('Complex processing failure');

      await failedHandler(mockJob, mockError);

      expect(mockDeadLetterQueue.add).toHaveBeenCalledWith(
        'dead-letter-job',
        expect.objectContaining({
          ...complexLabResult,
          status: 'dead',
          finalError: 'Complex processing failure',
        })
      );
    });
  });
});