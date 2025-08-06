import request from 'supertest';
import { createApp } from '../src/app';
import { QueueService } from '../src/services/queue.service';

// Mock QueueService
jest.mock('../src/services/queue.service');

// Create a proper mock type
type MockedQueueService = {
  [K in keyof QueueService]: jest.MockedFn<QueueService[K]>;
};

describe('Lab Results API', () => {
  let app: any;
  let mockQueueService: MockedQueueService;

  beforeEach(() => {
    // Create mock implementation
    mockQueueService = {
      addLabResult: jest.fn(),
      getQueueStats: jest.fn(),
      getDeadLetterCount: jest.fn(),
      close: jest.fn(),
    } as MockedQueueService;
    
    app = createApp(mockQueueService as unknown as QueueService);
  });

  describe('POST /api/lab-results', () => {
    const validLabResult = {
      patientId: '12345',
      labType: 'blood',
      result: 'positive',
      receivedAt: '2025-07-08T10:00:00.000Z',
    };

    it('should accept valid lab result', async () => {
      mockQueueService.addLabResult.mockResolvedValue('job-123');

      const response = await request(app)
        .post('/api/lab-results')
        .send(validLabResult)
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        message: 'Lab result queued for processing',
        jobId: 'job-123',
      });

      expect(mockQueueService.addLabResult).toHaveBeenCalledWith(validLabResult);
    });

    it('should reject invalid patient ID', async () => {
      const invalidLabResult = {
        ...validLabResult,
        patientId: '',
      };

      const response = await request(app)
        .post('/api/lab-results')
        .send(invalidLabResult)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation failed');
    });

    it('should reject invalid lab type', async () => {
      const invalidLabResult = {
        ...validLabResult,
        labType: 'invalid-type',
      };

      const response = await request(app)
        .post('/api/lab-results')
        .send(invalidLabResult)
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should reject invalid date format', async () => {
      const invalidLabResult = {
        ...validLabResult,
        receivedAt: 'invalid-date',
      };

      const response = await request(app)
        .post('/api/lab-results')
        .send(invalidLabResult)
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/stats', () => {
    it('should return queue statistics', async () => {
      const mockStats = {
        waiting: 5,
        active: 2,
        completed: 100,
        failed: 3,
        delayed: 1,
      };

      mockQueueService.getQueueStats.mockResolvedValue(mockStats);
      mockQueueService.getDeadLetterCount.mockResolvedValue(2);

      const response = await request(app)
        .get('/api/stats')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        stats: {
          ...mockStats,
          deadLettered: 2,
        },
      });
    });
  });

  describe('GET /api/health', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Lab Results Processing System is running');
    });
  });

  describe('404 handler', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await request(app)
        .get('/api/unknown-route')
        .expect(404);

      expect(response.body).toEqual({
        success: false,
        error: 'Route not found',
      });
    });
  });
});