import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectMongo, disconnectMongo } from './config/mongo.js';
import { createApp } from './app.js';
import { AdminUserModel } from './modules/admin/admin.models.js';
import { hashPassword } from './modules/admin/admin.password.js';

describe('catalog product metadata normalization', () => {
  let mongo: MongoMemoryServer;
  const app = createApp();
  let adminAccessToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ADMIN_JWT_ACCESS_SECRET = 'test_access_secret_1234567890';
    process.env.ADMIN_JWT_REFRESH_SECRET = 'test_refresh_secret_1234567890';
    process.env.USER_JWT_ACCESS_SECRET = 'test_user_access_secret_1234567890';
    process.env.USER_JWT_REFRESH_SECRET = 'test_user_refresh_secret_1234567890';

    mongo = await MongoMemoryServer.create();
    await connectMongo(mongo.getUri());

    await AdminUserModel.create({
      email: 'admin@buzzbar.com',
      passwordHash: await hashPassword('password12345'),
      role: 'admin',
      isActive: true
    });

    const login = await request(app).post('/api/v1/admin/auth/login').send({ email: 'admin@buzzbar.com', password: 'password12345' });
    expect(login.status).toBe(200);
    adminAccessToken = login.body.data.token as string;
  });

  afterAll(async () => {
    await disconnectMongo();
    await mongo.stop();
  });

  it('normalizes product metadata fields and persists variant label', async () => {
    const category = await request(app)
      .post('/api/v1/admin/categories')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Whisky', slug: 'whisky', isActive: true });
    const brand = await request(app)
      .post('/api/v1/admin/brands')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Brand', slug: 'brand', isActive: true });

    const created = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        name: 'Lagavulin 16',
        slug: 'lagavulin-16',
        brandId: brand.body.data._id,
        categoryId: category.body.data._id,
        countryOfOrigin: ' Scotland ',
        productType: ' Whisky ',
        subcategory: ' Single Malt ',
        ingredients: [' Malted barley ', ' water ', 'Water', ''],
        servingSuggestion: ' Best neat ',
        agingInfo: ' Aged 16 years ',
        authenticityNote: ' Imported original ',
        shortDescription: ' Rich smoky whisky ',
        tags: [' Smoky ', 'premium', 'PREMIUM', '', ' peated '],
        isActive: true
      });

    expect(created.status).toBe(201);
    expect(created.body.data.countryOfOrigin).toBe('Scotland');
    expect(created.body.data.productType).toBe('Whisky');
    expect(created.body.data.subcategory).toBe('Single Malt');
    expect(created.body.data.ingredients).toEqual(['Malted barley', 'water']);
    expect(created.body.data.servingSuggestion).toBe('Best neat');
    expect(created.body.data.agingInfo).toBe('Aged 16 years');
    expect(created.body.data.authenticityNote).toBe('Imported original');
    expect(created.body.data.shortDescription).toBe('Rich smoky whisky');
    expect(created.body.data.tags).toEqual(['smoky', 'premium', 'peated']);

    const productId = created.body.data._id as string;

    const variant = await request(app)
      .post(`/api/v1/admin/products/${productId}/variants`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ sku: 'LAGA-16-700', label: ' 700ML ', volumeMl: 700, packSize: 1, price: 12500, mrp: 13000, isActive: true });
    expect(variant.status).toBe(201);
    expect(variant.body.data.label).toBe('700ML');

    const updated = await request(app)
      .put(`/api/v1/admin/products/${productId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        tags: [' Islay ', 'islay', 'SMOKY'],
        ingredients: [' malted barley ', ' water '],
        servingSuggestion: null,
        authenticityNote: ' Duty-paid import '
      });
    expect(updated.status).toBe(200);
    expect(updated.body.data.tags).toEqual(['islay', 'smoky']);
    expect(updated.body.data.ingredients).toEqual(['malted barley', 'water']);
    expect(updated.body.data.servingSuggestion).toBeUndefined();
    expect(updated.body.data.authenticityNote).toBe('Duty-paid import');

    const detail = await request(app)
      .get(`/api/v1/admin/products/${productId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.product.tags).toEqual(['islay', 'smoky']);
    expect(detail.body.data.product.ingredients).toEqual(['malted barley', 'water']);
    expect(detail.body.data.product.countryOfOrigin).toBe('Scotland');
    expect(detail.body.data.variants[0].label).toBe('700ML');
  });
});
