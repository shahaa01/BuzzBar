import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

export class ApiError extends Error {
  readonly statusCode: number;
  readonly errorCode?: string;
  readonly details?: unknown;

  constructor(statusCode: number, message: string, opts?: { errorCode?: string; details?: unknown }) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = opts?.errorCode;
    this.details = opts?.details;
  }
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.path}`,
    errorCode: 'NOT_FOUND',
    requestId: req.requestId
  });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const log = (req as any).log as any | undefined;

  if (err instanceof ZodError) {
    log?.warn({ errorCode: 'VALIDATION_ERROR', issues: err.issues?.length ?? 0, requestId: (req as any).requestId }, 'Validation error');
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errorCode: 'VALIDATION_ERROR',
      details: err.issues,
      requestId: req.requestId
    });
  }

  const anyErr = err as any;
  if (anyErr && typeof anyErr === 'object' && anyErr.code === 11000) {
    log?.warn({ errorCode: 'DUPLICATE_KEY', details: anyErr.keyValue ?? undefined, requestId: (req as any).requestId }, 'Duplicate key');
    return res.status(409).json({
      success: false,
      message: 'Duplicate key',
      errorCode: 'DUPLICATE_KEY',
      details: anyErr.keyValue ?? undefined,
      requestId: req.requestId
    });
  }

  const statusCode = err instanceof ApiError ? err.statusCode : 500;
  const message = err instanceof Error ? err.message : 'Unknown error';
  const errorCode = err instanceof ApiError ? err.errorCode : 'INTERNAL_ERROR';
  const details = err instanceof ApiError ? err.details : undefined;

  if (statusCode >= 500) log?.error({ err: anyErr, statusCode, errorCode, requestId: (req as any).requestId }, 'Request error');
  else log?.warn({ statusCode, errorCode, requestId: (req as any).requestId }, 'Request error');

  res.status(statusCode).json({
    success: false,
    message,
    errorCode,
    details,
    requestId: req.requestId
  });
}
