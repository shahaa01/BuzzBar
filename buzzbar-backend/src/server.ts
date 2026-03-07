import http from 'node:http';
import { createApp } from './app.js';
import { getEnv } from './config/env.js';
import { connectMongo, disconnectMongo } from './config/mongo.js';
import { createLogger } from './config/logger.js';
import { bootstrapAdminPhase } from './modules/admin/bootstrap.js';
import { startBackgroundJobs } from './jobs/worker.js';

const log = createLogger();

async function main() {
  const env = getEnv();
  await connectMongo(env.MONGO_URI);
  await bootstrapAdminPhase(env);

  const app = createApp();
  const server = http.createServer(app);
  const jobs = startBackgroundJobs();

  server.listen(env.PORT, () => {
    log.info({ port: env.PORT }, 'API listening');
  });

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'Shutting down');
    server.close(async () => {
      try {
        jobs.stop();
        await disconnectMongo();
      } finally {
        process.exit(0);
      }
    });
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  log.error({ err }, 'Fatal startup error');
  process.exit(1);
});
