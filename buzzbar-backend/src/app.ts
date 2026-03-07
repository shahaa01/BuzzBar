import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { createLogger } from './config/logger.js';
import { requestIdMiddleware } from './common/middleware/request_id.js';
import { errorHandler, notFoundHandler } from './common/middleware/error_handler.js';
import { isMongoReady } from './config/mongo.js';
import { adminRouter } from './modules/admin/admin.router.js';
import { authRouter } from './modules/auth/auth.router.js';
import { meRouter } from './modules/user/me.router.js';
import { catalogPublicRouter } from './modules/catalog/catalog.public.router.js';
import { catalogAdminRouter } from './modules/catalog/catalog.admin.router.js';
import { uploadsAdminRouter } from './modules/uploads/uploads.admin.router.js';
import { inventoryAdminRouter } from './modules/inventory/inventory.admin.router.js';
import { kycRouter } from './modules/kyc/kyc.router.js';
import { kycAdminRouter } from './modules/kyc/kyc.admin.router.js';
import { cartRouter } from './modules/cart/cart.router.js';
import { promotionsRouter } from './modules/promotions/promotions.router.js';
import { ordersRouter } from './modules/orders/orders.router.js';
import { ordersAdminRouter } from './modules/orders/orders.admin.router.js';
import { paymentsRouter } from './modules/payments/payments.router.js';
import { paymentsAdminRouter } from './modules/payments/payments.admin.router.js';

function buildCors() {
  const raw = process.env.CORS_ORIGINS?.trim();
  const allowlist = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];

  return cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (allowlist.includes(origin)) return cb(null, true);

      if (process.env.NODE_ENV !== 'production') {
        if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return cb(null, true);
      }

      return cb(new Error('CORS blocked'), false);
    },
    credentials: true
  });
}

export function createApp() {
  const app = express();
  const logger = createLogger();

  app.disable('x-powered-by');

  app.use(requestIdMiddleware);
  app.use(
    pinoHttp({
      logger,
      genReqId(req) {
        return (req as any).requestId;
      },
      customProps(req) {
        return { requestId: (req as any).requestId };
      }
    })
  );
  app.use(helmet());

  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: true,
      legacyHeaders: false
    })
  );

  app.use(buildCors());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  app.get('/health', (req, res) => {
    res.status(200).json({
      ok: true,
      status: 'healthy',
      requestId: req.requestId,
      ts: new Date().toISOString()
    });
  });

  app.get('/ready', (req, res) => {
    if (!isMongoReady()) {
      return res.status(503).json({
        ok: false,
        status: 'not_ready',
        reason: 'mongo_not_connected',
        requestId: req.requestId
      });
    }
    return res.status(200).json({
      ok: true,
      status: 'ready',
      requestId: req.requestId
    });
  });

  app.use('/api/v1/admin', adminRouter());
  app.use('/api/v1/admin', catalogAdminRouter());
  app.use('/api/v1/admin', uploadsAdminRouter());
  app.use('/api/v1/admin', inventoryAdminRouter());
  app.use('/api/v1/admin', kycAdminRouter());
  app.use('/api/v1/admin', ordersAdminRouter());
  app.use('/api/v1/admin', paymentsAdminRouter());
  app.use('/api/v1/auth', authRouter());
  app.use('/api/v1/me', meRouter());
  app.use('/api/v1/kyc', kycRouter());
  app.use('/api/v1/cart', cartRouter());
  app.use('/api/v1/promotions', promotionsRouter());
  app.use('/api/v1/orders', ordersRouter());
  app.use('/api/v1/payments', paymentsRouter());
  app.use('/api/v1', catalogPublicRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
