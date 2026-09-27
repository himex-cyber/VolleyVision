import { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Express 4 ignores the promise an async middleware returns, so a rejection
 * (a database error inside a permission check) never reaches the error
 * handler: the request just hangs until the Netlify Function times out. This
 * forwards the rejection to next() so it becomes a normal 500.
 *
 * ponytail: per-middleware wrapper. Express 5 does this natively; upgrading
 * removes the need, but its types make every req.params value string | string[]
 * (129 type errors today), so it's a separate piece of work.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
