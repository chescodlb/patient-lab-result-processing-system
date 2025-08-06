import { Request, Response } from 'express';
import { QueueService } from '../services/queue.service';
import { validateLabResult } from '../validation/labResult.validation';
import { logger } from '../utils/logger';

interface RequestWithBody extends Request {
    socket: any;
    body: { [key: string]: string | undefined };
}

export class LabResultsController {
  constructor(private queueService: QueueService) {}

  async submitLabResult(req: RequestWithBody, res: Response): Promise<void> {
    try {
      const { error, value } = validateLabResult(req.body);
      
      if (error) {
        return(res as any).status(400).json({
          success: false,
          error: 'Validation failed',
          details: error.details.map((d: any) => d.message),
        });
      }

      const jobId = await this.queueService.addLabResult(value);

      logger.debug('Lab result submitted', {
        jobId,
        patientId: value.patientId,
        ip: req.socket.remoteAddress,
      });

      return (res as any).status(200).json({
        success: true,
        message: 'Lab result queued for processing',
        jobId,
      });
    } catch (error) {
      logger.error('Failed to submit lab result', {
        error: error instanceof Error ? error.message : 'Unknown error',
        body: req.body,
      });

      return (res as any).status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }

  async getStats(req: Request, res: Response): Promise<void> {
    try {
      const queueStats = await this.queueService.getQueueStats();
      const deadLetterCount = await this.queueService.getDeadLetterCount();

      (res as any).json({
        success: true,
        stats: {
          ...queueStats,
          deadLettered: deadLetterCount,
        },
      });
    } catch (error) {
      logger.error('Failed to get stats', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      (res as any).status(500).json({
        success: false,
        error: 'Failed to retrieve stats',
      });
    }
  }

  async healthCheck(req: Request, res: Response): Promise<void> {
    (res as any).json({
      success: true,
      message: 'Lab Results Processing System is running',
      timestamp: new Date().toISOString(),
    });
  }
}