import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectMongo, disconnectMongo } from './config/mongo.js';
import { createApp } from './app.js';
import { AdminUserModel } from './modules/admin/admin.models.js';
import { hashPassword } from './modules/admin/admin.password.js';
import { InventoryStockModel } from './modules/inventory/inventory.models.js';

describe('P2.2C admin products list stockStatus (worst active variant availability)', () => {
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

  it('computes out_of_stock/low_stock/in_stock using min availability among active variants', async () => {
    const category = await request(app)
      .post('/api/v1/admin/categories')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Cat', slug: 'cat', isActive: true });
    const brand = await request(app)
      .post('/api/v1/admin/brands')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Brand', slug: 'brand', isActive: true });
    expect(category.status).toBe(201);
    expect(brand.status).toBe(201);

    const mkProduct = async (name: string, slug: string) => {
      const res = await request(app)
        .post('/api/v1/admin/products')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ name, slug, brandId: brand.body.data._id, categoryId: category.body.data._id, isActive: true });
      expect(res.status).toBe(201);
      return res.body.data._id as string;
    };

    const mkVariant = async (productId: string, sku: string, isActive = true) => {
      const res = await request(app)
        .post(`/api/v1/admin/products/${productId}/variants`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ sku, volumeMl: 750, packSize: 1, price: 1000, isActive });
      expect(res.status).toBe(201);
      return res.body.data._id as string;
    };

    const pOut = await mkProduct('Out', 'out');
    const vOut0 = await mkVariant(pOut, 'SKU-OUT-0');
    const vOut10 = await mkVariant(pOut, 'SKU-OUT-10');
    await InventoryStockModel.updateOne({ variantId: vOut0 }, { $set: { quantity: 0, reserved: 0 } }, { upsert: true });
    await InventoryStockModel.updateOne({ variantId: vOut10 }, { $set: { quantity: 10, reserved: 0 } }, { upsert: true });

    const pLow = await mkProduct('Low', 'low');
    const vLow2 = await mkVariant(pLow, 'SKU-LOW-2');
    const vLow7 = await mkVariant(pLow, 'SKU-LOW-7');
    await InventoryStockModel.updateOne({ variantId: vLow2 }, { $set: { quantity: 2, reserved: 0 } }, { upsert: true });
    await InventoryStockModel.updateOne({ variantId: vLow7 }, { $set: { quantity: 7, reserved: 0 } }, { upsert: true });

    const pIn = await mkProduct('In', 'in');
    const vIn6 = await mkVariant(pIn, 'SKU-IN-6');
    const vIn9 = await mkVariant(pIn, 'SKU-IN-9');
    await InventoryStockModel.updateOne({ variantId: vIn6 }, { $set: { quantity: 6, reserved: 0 } }, { upsert: true });
    await InventoryStockModel.updateOne({ variantId: vIn9 }, { $set: { quantity: 9, reserved: 0 } }, { upsert: true });

    const pNone = await mkProduct('NoneActive', 'none-active');
    await mkVariant(pNone, 'SKU-INACTIVE', false);

    const list = await request(app)
      .get('/api/v1/admin/products?page=1&limit=20&lowStockThreshold=5')
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(list.status).toBe(200);
    expect(list.body.success).toBe(true);

    const byName = new Map((list.body.data.items as any[]).map((i) => [i.name, i]));
    expect(byName.get('Out')?.stockStatus).toBe('out_of_stock');
    // Low: min availability is 2 (<=5)
    expect(byName.get('Low')?.stockStatus).toBe('low_stock');
    // In: min availability is 6 (>5)
    expect(byName.get('In')?.stockStatus).toBe('in_stock');
    // No active variants => out_of_stock
    expect(byName.get('NoneActive')?.stockStatus).toBe('out_of_stock');

    const listTight = await request(app)
      .get('/api/v1/admin/products?page=1&limit=20&lowStockThreshold=1')
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(listTight.status).toBe(200);
    const byNameTight = new Map((listTight.body.data.items as any[]).map((i) => [i.name, i]));
    // Low: min availability is 2 (>1) -> in_stock
    expect(byNameTight.get('Low')?.stockStatus).toBe('in_stock');
  });
});

