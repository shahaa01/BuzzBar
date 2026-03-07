import mongoose from 'mongoose';
import { createLogger } from './logger.js';

const log = createLogger();

export async function connectMongo(mongoUri: string) {
  mongoose.set('strictQuery', true);

  mongoose.connection.on('connected', () => log.info({ mongoUri }, 'Mongo connected'));
  mongoose.connection.on('disconnected', () => log.warn('Mongo disconnected'));
  mongoose.connection.on('error', (err) => log.error({ err }, 'Mongo error'));

  await mongoose.connect(mongoUri);
}

export async function disconnectMongo() {
  await mongoose.disconnect();
}

export function isMongoReady() {
  return mongoose.connection.readyState === 1;
}

