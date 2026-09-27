import { Request, Response, NextFunction } from 'express';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    // Machine-readable discriminator for responses a client needs to branch
    // on (e.g. EMAIL_NOT_VERIFIED) rather than string-match the message.
    // Optional and additive — every existing AppError without one keeps
    // returning exactly { error } as before.
    public code?: string
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
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
    return;
  }

  // Prisma unique constraint violation
  if ((err as any).code === 'P2002') {
    res.status(409).json({ error: 'A record with those details already exists.' });
    return;
  }

  // Prisma record not found
  if ((err as any).code === 'P2025') {
    res.status(404).json({ error: 'Record not found.' });
    return;
  }

  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'An unexpected error occurred.' });
}
