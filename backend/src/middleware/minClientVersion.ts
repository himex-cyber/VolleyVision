import { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler';
import { isOutdated } from '../lib/clientVersion';

/** 426 for an app build below the minimum (lib/clientVersion); everything else passes. */
export function minClientVersion(req: Request, _res: Response, next: NextFunction) {
  if (isOutdated(req.get('x-client'))) {
    return next(new AppError(426, 'This version of VolleyVision is out of date. Please update the app.', 'APP_OUTDATED'));
  }
  next();
}
