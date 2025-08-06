import { Router } from 'express';
import { LabResultsController } from '../controllers/labResults.controller';
import { QueueService } from '../services/queue.service';

export function createLabResultsRoutes(queueService: QueueService): Router {
  const router = Router();
  const controller = new LabResultsController(queueService);

  router.post('/lab-results', controller.submitLabResult.bind(controller));
  router.get('/stats', controller.getStats.bind(controller));
  router.get('/health', controller.healthCheck.bind(controller));

  return router;
}