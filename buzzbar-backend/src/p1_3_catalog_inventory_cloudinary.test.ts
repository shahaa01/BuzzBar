import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectMongo, disconnectMongo } from './config/mongo.js';
import { createApp } from './app.js';
import { AdminUserModel } from './modules/admin/admin.models.js';
import { hashPassword } from './modules/admin/admin.password.js';

describe('P1.3 catalog + inventory + cloudinary', () => {
  let mongo: MongoMemoryServer;
  const app = createApp();
  let adminAccessToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';

    // Required secrets for JWT verification
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

    const login = await request(app)
      .post('/api/v1/admin/auth/login')
      .send({ email: 'admin@buzzbar.com', password: 'password12345' });
    expect(login.status).toBe(200);
    adminAccessToken = login.body.data.token;
    expect(adminAccessToken).toBeTruthy();
  });

  afterAll(async () => {
    await disconnectMongo();
    await mongo.stop();
  });

  it('Cloudinary upload endpoint validates MIME + size and returns asset', async () => {
    const bad = await request(app)
      .post('/api/v1/admin/uploads/image')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .attach('file', Buffer.from('hello'), { filename: 'x.txt', contentType: 'text/plain' });
    expect(bad.status).toBe(400);
    expect(bad.body.errorCode).toBe('UPLOAD_UNSUPPORTED_MIME');

    const big = await request(app)
      .post('/api/v1/admin/uploads/image')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .attach('file', Buffer.alloc(11 * 1024 * 1024), { filename: 'x.png', contentType: 'image/png' });
    expect(big.status).toBe(400);
    expect(big.body.errorCode).toBe('UPLOAD_FILE_TOO_LARGE');

    const ok = await request(app)
      .post('/api/v1/admin/uploads/image')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .field('target', 'products')
      .field('targetId', 'temp')
      .attach('file', Buffer.from([0x89, 0x50, 0x4e, 0x47]), { filename: 'x.png', contentType: 'image/png' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.url).toBeTruthy();
    expect(ok.body.data.publicId).toBeTruthy();
  });

  it('Admin can create category/brand/product/variant; attach image; public can fetch; inventory availability works', async () => {
    // Create category
    const catRes = await request(app)
      .post('/api/v1/admin/categories')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Whiskey', sortOrder: 1 });
    expect(catRes.status).toBe(201);
    const categoryId = catRes.body.data._id as string;
    expect(catRes.body.data.slug).toBe('whiskey');

    // Create same category again => slug collision handled with suffix
    const catRes2 = await request(app)
      .post('/api/v1/admin/categories')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Whiskey', sortOrder: 2 });
    expect(catRes2.status).toBe(201);
    expect(catRes2.body.data.slug).toBe('whiskey-2');

    // Create brand
    const brandRes = await request(app)
      .post('/api/v1/admin/brands')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Johnnie Walker' });
    expect(brandRes.status).toBe(201);
    const brandId = brandRes.body.data._id as string;

    // Upload image (mocked in NODE_ENV=test)
    const uploadRes = await request(app)
      .post('/api/v1/admin/uploads/image')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .field('target', 'products')
      .field('targetId', 'temp')
      .attach('file', Buffer.from([0x89, 0x50, 0x4e, 0x47]), { filename: 'x.png', contentType: 'image/png' });
    expect(uploadRes.status).toBe(200);
    const asset = uploadRes.body.data;

    // Create product with image + ABV
    const prodRes = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        name: 'Black Label',
        brandId,
        categoryId,
        description: '12 year blended scotch',
        abv: 40,
        images: [asset]
      });
    expect(prodRes.status).toBe(201);
    const productId = prodRes.body.data._id as string;

    // Create variant
    const varRes = await request(app)
      .post(`/api/v1/admin/products/${productId}/variants`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        sku: 'JW-BL-750-1',
        volumeMl: 750,
        packSize: 1,
        price: 4200,
        mrp: 4500
      });
    expect(varRes.status).toBe(201);
    const variantId = varRes.body.data._id as string;

    // Inventory starts at 0 => out of stock
    const listOut = await request(app).get('/api/v1/products').query({ inStock: 'true' });
    expect(listOut.status).toBe(200);
    expect(listOut.body.data.items.length).toBe(0);

    // Adjust inventory +10 (RECEIVE)
    const adj = await request(app)
      .patch('/api/v1/admin/inventory/adjust')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ variantId, delta: 10, reason: 'Initial stock' });
    expect(adj.status).toBe(200);
    expect(adj.body.data.stock.quantity).toBe(10);
    expect(adj.body.data.availability).toBe(10);
    expect(adj.body.data.movement.type).toBe('RECEIVE');

    // Attempt huge negative adjustment must fail cleanly
    const fail = await request(app)
      .patch('/api/v1/admin/inventory/adjust')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ variantId, delta: -999999, reason: 'Bad adjust' });
    expect(fail.status).toBe(409);
    expect(fail.body.errorCode).toBe('INSUFFICIENT_STOCK');

    // Public list inStock should now include product
    const listIn = await request(app).get('/api/v1/products').query({ inStock: 'true', sort: 'price_asc' });
    expect(listIn.status).toBe(200);
    expect(listIn.body.data.items.length).toBe(1);
    expect(listIn.body.data.items[0]._id).toBe(productId);

    // Product detail includes variants + availability
    const detail = await request(app).get(`/api/v1/products/${productId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.product.images.length).toBe(1);
    expect(detail.body.data.variants[0].availability).toBe(10);

    // Filter by volume
    const byVolume = await request(app).get('/api/v1/products').query({ volumeMl: 750 });
    expect(byVolume.status).toBe(200);
    expect(byVolume.body.data.items.length).toBe(1);
  });
});
