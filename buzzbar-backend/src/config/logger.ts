import pino from 'pino';

export function createLogger() {
  const level = process.env.NODE_ENV === 'test' ? 'silent' : (process.env.LOG_LEVEL ?? 'info');
  return pino({
    level,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie'],
      remove: true
    }
  });
}

