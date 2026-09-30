import { Request, Response, NextFunction } from 'express';
import { mapErrorToResponse } from '../lib/mapError';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    // Machine-readable discriminator for responses a client needs to branch
    // on (e.g. EMAIL_NOT_VERIFIED) rather than string-match the message.
    // Optional and additive — every existing AppError without one keeps
    // returning exactly { error } as before.
    public code?: string,
    // Extra fields for the response body (e.g. `teams` on ACCOUNT_HAS_TEAMS).
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const { status, body } = mapErrorToResponse(err);
  if (status === 500) {
    console.error('Unhandled error:', err);
  }
  res.status(status).json(body);
}
