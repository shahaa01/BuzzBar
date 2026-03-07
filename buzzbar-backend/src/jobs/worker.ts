import { createLogger } from '../config/logger.js';
import { cleanupStaleWalletOrders } from './stale_wallet_cleanup.js';

export function startBackgroundJobs() {
  const log = createLogger();

  if (process.env.NODE_ENV === 'test') {
    return { stop: () => {} };
  }

  const intervalMs = 60_000;
  const handle = setInterval(() => {
    cleanupStaleWalletOrders({ log }).catch((err) => {
      log.error({ err }, 'Stale wallet cleanup job failed');
    });
  }, intervalMs);

  handle.unref();
  log.info({ intervalMs }, 'Background jobs started');

  return {
    stop: () => {
      clearInterval(handle);
      log.info('Background jobs stopped');
    }
  };
}

