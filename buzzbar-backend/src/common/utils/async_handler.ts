import type { NextFunction, Request, RequestHandler, Response } from 'express';

export function asyncHandler<TReq extends Request = Request>(
  fn: (req: TReq, res: Response, next: NextFunction) => Promise<void>
): RequestHandler {
  return (req, res, next) => {
    void fn(req as TReq, res, next).catch(next);
  };
}

