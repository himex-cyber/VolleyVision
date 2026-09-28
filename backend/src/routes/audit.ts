import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { resource, limit = '50' } = req.query as Record<string, string>;
    const logs = await prisma.auditLog.findMany({
      where: { userId: req.user!.userId, ...(resource ? { resource } : {}) },
      orderBy: { createdAt: 'desc' },
      // parseInt, not Number: '12abc' is 12, anything unparseable is the default.
      take: Math.min(Math.max(1, parseInt(limit, 10) || 50), 200),
    });
    res.json(logs);
  } catch (err) {
    next(err);
  }
});

export default router;
