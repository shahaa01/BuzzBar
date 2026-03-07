import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from './app.js';
import { connectMongo, disconnectMongo } from './config/mongo.js';

describe('P1.0 health/ready', () => {
  const app = createApp();

  it('GET /health returns 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('GET /ready returns 503 when mongo disconnected', async () => {
    const res = await request(app).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body.reason).toBe('mongo_not_connected');
  });

  it('GET /ready returns 200 when mongo connected', async () => {
    const mongo = await MongoMemoryServer.create();
    await connectMongo(mongo.getUri());
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    await disconnectMongo();
    await mongo.stop();
  });
});
