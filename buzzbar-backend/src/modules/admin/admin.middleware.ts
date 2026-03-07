import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../../common/middleware/error_handler.js';
import { verifyAdminAccessToken } from './admin.jwt.js';
import type { AdminRole } from './admin.types.js';
import { AdminUserModel } from './admin.models.js';

declare global {
  namespace Express {
    interface Request {
      admin?: { id: string; role: AdminRole };
    }
  }
}

export async function authenticateAdmin(req: Request, _res: Response, next: NextFunction) {
  const auth = req.header('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
  if (!token) return next(new ApiError(401, 'Missing admin access token', { errorCode: 'ADMIN_UNAUTHORIZED' }));

  try {
    const verified = await verifyAdminAccessToken(token);
    const admin = (await AdminUserModel.findById(verified.adminId)
      .select({ role: 1, isActive: 1 })
      .lean()
      .exec()) as any;
    if (!admin || !admin.isActive) {
      return next(new ApiError(401, 'Invalid admin access token', { errorCode: 'ADMIN_UNAUTHORIZED' }));
    }
    req.admin = { id: verified.adminId, role: admin.role as AdminRole };
    return next();
  } catch {
    return next(new ApiError(401, 'Invalid admin access token', { errorCode: 'ADMIN_UNAUTHORIZED' }));
  }
}

export function requireAdminRole(roles: AdminRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const role = req.admin?.role;
    if (!role) return next(new ApiError(401, 'Missing admin context', { errorCode: 'ADMIN_UNAUTHORIZED' }));
    if (!roles.includes(role)) {
      return next(new ApiError(403, 'Forbidden', { errorCode: 'ADMIN_FORBIDDEN' }));
    }
    return next();
  };
}
