import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectMongo, disconnectMongo } from './config/mongo.js';
import { createApp } from './app.js';
import { SettingsModel, SETTINGS_SINGLETON_ID } from './modules/admin/admin.models.js';
import { UserModel } from './modules/user/user.models.js';
import { CategoryModel, BrandModel, ProductModel, VariantModel } from './modules/catalog/catalog.models.js';
import { InventoryStockModel } from './modules/inventory/inventory.models.js';
import { OrderModel } from './modules/orders/orders.models.js';
import { PaymentTransactionModel } from './modules/payments/payments.models.js';

describe('P1.7 payments (core + mock)', () => {
  let mongo: MongoMemoryServer;
  const app = createApp();

  function formatHm(mins: number) {
    const m = ((mins % (24 * 60)) + 24 * 60) % (24 * 60);
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ADMIN_JWT_ACCESS_SECRET = 'test_admin_access_secret_1234567890';
    process.env.ADMIN_JWT_REFRESH_SECRET = 'test_admin_refresh_secret_1234567890';
    process.env.USER_JWT_ACCESS_SECRET = 'test_user_access_secret_1234567890';
    process.env.USER_JWT_REFRESH_SECRET = 'test_user_refresh_secret_1234567890';

    mongo = await MongoMemoryServer.create();
    await connectMongo(mongo.getUri());

    // Avoid time-dependent COD failures by configuring a 1-minute night window far in the future (Kathmandu time).
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kathmandu',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(now);
    const m = parts.match(/^(\d{2}):(\d{2})$/);
    const nowMin = m ? Number(m[1]) * 60 + Number(m[2]) : 0;

    await SettingsModel.updateOne(
      { _id: SETTINGS_SINGLETON_ID },
      {
        $set: {
          _id: SETTINGS_SINGLETON_ID,
          nightHours: { start: formatHm(nowMin + 60), end: formatHm(nowMin + 61), timezone: 'Asia/Kathmandu' },
          serviceAreas: ['Kathmandu', 'Lalitpur', 'Bhaktapur'],
          deliveryFeeFlat: 20
        }
      },
      { upsert: true }
    );
  });

  afterAll(async () => {
    await disconnectMongo();
    await mongo.stop();
  });

  async function signup(email: string) {
    const res = await request(app).post('/api/v1/auth/signup').send({ email, password: 'password123', name: 'X' });
    expect(res.status).toBe(201);
    return { token: res.body.data.token as string, userId: res.body.data.user.id as string };
  }

  async function seedVariant(price: number, available: number) {
    const category = await CategoryModel.create({ name: 'Cat', slug: `cat-${Date.now()}` });
    const brand = await BrandModel.create({ name: 'Brand', slug: `brand-${Date.now()}` });
    const product = await ProductModel.create({
      name: 'Product A',
      slug: `product-a-${Date.now()}`,
      brandId: brand._id,
      categoryId: category._id,
      images: [{ url: 'https://example.com/a.png', publicId: 'p1', format: 'png' }],
      isActive: true
    });
    const variant = await VariantModel.create({
      productId: product._id,
      sku: `SKU-${Date.now()}`,
      volumeMl: 750,
      packSize: 1,
      price,
      isActive: true
    });
    await InventoryStockModel.create({ variantId: variant._id, quantity: available, reserved: 0 });
    return { variantId: variant._id.toString() };
  }

  async function createOrder(opts: { paymentMethod: 'COD' | 'WALLET'; email: string }) {
    const { token, userId } = await signup(opts.email);
    await UserModel.updateOne({ _id: userId }, { $set: { kycStatus: 'verified' } });

    const { variantId } = await seedVariant(1000, 5);
    const add = await request(app).post('/api/v1/cart/items').set('Authorization', `Bearer ${token}`).send({ variantId, qty: 1 });
    expect(add.status).toBe(200);

    const create = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ paymentMethod: opts.paymentMethod, address: { fullAddress: 'Some address', area: 'Kathmandu' } });
    expect(create.status).toBe(201);

    return { token, userId, orderId: create.body.data.orderId as string, variantId };
  }

  it('payment init creates PaymentTransaction', async () => {
    const { token, orderId } = await createOrder({ paymentMethod: 'WALLET', email: 'p1@buzzbar.com' });

    const init = await request(app).post('/api/v1/payments/init').set('Authorization', `Bearer ${token}`).send({ orderId, provider: 'MOCK' });
    expect(init.status).toBe(200);
    expect(init.body.data.status).toBe('INITIATED');
    expect(init.body.data.transactionId).toBeTruthy();

    const tx = (await PaymentTransactionModel.findOne({ orderId }).lean().exec()) as any;
    expect(tx).toBeTruthy();
    expect(tx.provider).toBe('MOCK');
    expect(tx.status).toBe('INITIATED');
  });

  it('mock confirm success marks order paid and confirms it', async () => {
    const { token, orderId, variantId } = await createOrder({ paymentMethod: 'WALLET', email: 'p2@buzzbar.com' });
    await request(app).post('/api/v1/payments/init').set('Authorization', `Bearer ${token}`).send({ orderId, provider: 'MOCK' });

    const confirm = await request(app)
      .post('/api/v1/payments/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ orderId, provider: 'MOCK', payload: { mode: 'SUCCESS' } });
    expect(confirm.status).toBe(200);
    expect(confirm.body.data.status).toBe('SUCCESS');

    const tx = (await PaymentTransactionModel.findOne({ orderId }).lean().exec()) as any;
    expect(tx.status).toBe('SUCCESS');

    const order = (await OrderModel.findById(orderId).lean().exec()) as any;
    expect(order.paymentStatus).toBe('PAID');
    expect(order.status).toBe('CONFIRMED');

    const stock = (await InventoryStockModel.findOne({ variantId }).lean().exec()) as any;
    expect(stock.reserved).toBe(1);
  });

  it('mock confirm failure cancels order and releases reserved stock', async () => {
    const { token, orderId, variantId } = await createOrder({ paymentMethod: 'WALLET', email: 'p3@buzzbar.com' });
    await request(app).post('/api/v1/payments/init').set('Authorization', `Bearer ${token}`).send({ orderId, provider: 'MOCK' });

    const confirm = await request(app)
      .post('/api/v1/payments/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ orderId, provider: 'MOCK', payload: { mode: 'FAILED' } });
    expect(confirm.status).toBe(200);
    expect(confirm.body.data.status).toBe('FAILED');

    const order = (await OrderModel.findById(orderId).lean().exec()) as any;
    expect(order.paymentStatus).toBe('FAILED');
    expect(order.status).toBe('CANCELLED');

    const stock = (await InventoryStockModel.findOne({ variantId }).lean().exec()) as any;
    expect(stock.reserved).toBe(0);
  });

  it('idempotency: repeated success confirm does not duplicate effects', async () => {
    const { token, orderId } = await createOrder({ paymentMethod: 'WALLET', email: 'p4@buzzbar.com' });
    await request(app).post('/api/v1/payments/init').set('Authorization', `Bearer ${token}`).send({ orderId, provider: 'MOCK' });

    const c1 = await request(app)
      .post('/api/v1/payments/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ orderId, provider: 'MOCK', payload: { mode: 'SUCCESS' } });
    expect(c1.status).toBe(200);

    const c2 = await request(app)
      .post('/api/v1/payments/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ orderId, provider: 'MOCK', payload: { mode: 'SUCCESS' } });
    expect(c2.status).toBe(200);
    expect(c2.body.data.status).toBe('SUCCESS');

    const txCount = await PaymentTransactionModel.countDocuments({ orderId });
    expect(txCount).toBe(1);

    const order = (await OrderModel.findById(orderId).lean().exec()) as any;
    expect(order.paymentStatus).toBe('PAID');
    expect(order.status).toBe('CONFIRMED');
  });

  it('idempotency: repeated failure confirm does not double-release reserved', async () => {
    const { token, orderId, variantId } = await createOrder({ paymentMethod: 'WALLET', email: 'p5@buzzbar.com' });
    await request(app).post('/api/v1/payments/init').set('Authorization', `Bearer ${token}`).send({ orderId, provider: 'MOCK' });

    const c1 = await request(app)
      .post('/api/v1/payments/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ orderId, provider: 'MOCK', payload: { mode: 'FAILED' } });
    expect(c1.status).toBe(200);

    const c2 = await request(app)
      .post('/api/v1/payments/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ orderId, provider: 'MOCK', payload: { mode: 'FAILED' } });
    expect(c2.status).toBe(200);
    expect(c2.body.data.status).toBe('FAILED');

    const stock = (await InventoryStockModel.findOne({ variantId }).lean().exec()) as any;
    expect(stock.reserved).toBe(0);
  });

  it('guards: cannot init payment for COD order', async () => {
    // Create a wallet order (stable across night-hours), then flip to COD in DB to test the guard deterministically.
    const { token, orderId } = await createOrder({ paymentMethod: 'WALLET', email: 'p6@buzzbar.com' });
    await OrderModel.updateOne({ _id: orderId }, { $set: { paymentMethod: 'COD', paymentStatus: 'UNPAID' } });
    const init = await request(app).post('/api/v1/payments/init').set('Authorization', `Bearer ${token}`).send({ orderId, provider: 'MOCK' });
    expect(init.status).toBe(409);
    expect(init.body.errorCode).toBe('PAYMENT_INVALID_METHOD');
  });

  it("guards: cannot confirm someone else's order", async () => {
    const { token, orderId } = await createOrder({ paymentMethod: 'WALLET', email: 'p7@buzzbar.com' });
    await request(app).post('/api/v1/payments/init').set('Authorization', `Bearer ${token}`).send({ orderId, provider: 'MOCK' });

    const other = await signup('p8@buzzbar.com');
    const confirm = await request(app)
      .post('/api/v1/payments/confirm')
      .set('Authorization', `Bearer ${other.token}`)
      .send({ orderId, provider: 'MOCK', payload: { mode: 'SUCCESS' } });
    expect(confirm.status).toBe(404);
    expect(confirm.body.errorCode).toBe('PAYMENT_INVALID_ORDER');
  });

  it('invalid provider returns PAYMENT_PROVIDER_NOT_SUPPORTED (not a validation error)', async () => {
    const { token, orderId } = await createOrder({ paymentMethod: 'WALLET', email: 'p9@buzzbar.com' });
    const init = await request(app).post('/api/v1/payments/init').set('Authorization', `Bearer ${token}`).send({ orderId, provider: 'ESEWA' });
    expect(init.status).toBe(400);
    expect(init.body.errorCode).toBe('PAYMENT_PROVIDER_NOT_SUPPORTED');
  });
});
