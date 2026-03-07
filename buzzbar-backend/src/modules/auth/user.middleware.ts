import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../../common/middleware/error_handler.js';
import { verifyUserAccessToken } from './user.jwt.js';

declare global {
  namespace Express {
    interface Request {
      user?: { id: string };
    }
  }
}

export async function authenticateUser(req: Request, _res: Response, next: NextFunction) {
  const auth = req.header('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
  if (!token) return next(new ApiError(401, 'Missing access token', { errorCode: 'UNAUTHORIZED' }));

  try {
    const verified = await verifyUserAccessToken(token);
    req.user = { id: verified.userId };
    return next();
  } catch {
    return next(new ApiError(401, 'Invalid access token', { errorCode: 'UNAUTHORIZED' }));
  }
}

