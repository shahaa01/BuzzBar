import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('x-request-id');
  const id = incoming && incoming.trim().length > 0 ? incoming.trim() : randomUUID();
  req.requestId = id;
  res.setHeader('x-request-id', id);
  next();
}

