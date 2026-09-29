import { Router } from 'express';
import {
  recordEvent,
  recordEventBatch,
  getEventsByMatch,
  deleteLastEvent,
  deleteEvent,
} from '../controllers/events';
import { requireAuth, optionalAuth } from '../middleware/auth';
import { requireEventPermission, requireEventDeletePermission } from '../middleware/permissions';
import { visibleByMatchParam } from '../middleware/visibility';
import { Permission } from '../services/permission.service';
import { eventWriteRateLimit, eventBatchRateLimit } from '../middleware/rateLimit';

const router = Router();

router.post('/', requireAuth, eventWriteRateLimit, requireEventPermission(Permission.TRACK_MATCH), recordEvent);
router.post('/batch', requireAuth, eventBatchRateLimit, requireEventPermission(Permission.TRACK_MATCH), recordEventBatch);
router.get('/by-match/:matchId', optionalAuth, visibleByMatchParam('matchId'), getEventsByMatch);
router.delete('/undo/:matchId', requireAuth, eventWriteRateLimit, requireEventDeletePermission(Permission.TRACK_MATCH), deleteLastEvent);
router.delete('/:id', requireAuth, eventWriteRateLimit, requireEventDeletePermission(Permission.TRACK_MATCH), deleteEvent);

export default router;
