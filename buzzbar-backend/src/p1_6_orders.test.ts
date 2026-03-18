import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectMongo, disconnectMongo } from './config/mongo.js';
import { createApp } from './app.js';
import { SettingsModel, SETTINGS_SINGLETON_ID, AdminUserModel } from './modules/admin/admin.models.js';
import { hashPassword } from './modules/admin/admin.password.js';
import { UserModel } from './modules/user/user.models.js';
import { CategoryModel, BrandModel, ProductModel, VariantModel } from './modules/catalog/catalog.models.js';
import { InventoryStockModel } from './modules/inventory/inventory.models.js';
import { PromotionModel } from './modules/promotions/promotions.models.js';
import { OrderModel } from './modules/orders/orders.models.js';

function getNowMinutesInTz(timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  const m = parts.match(/^(\d{2}):(\d{2})$/);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

function hmFromMinutes(min: number) {
  const m = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

describe('P1.6 orders', () => {
  let mongo: MongoMemoryServer;
  const app = createApp();
  let adminAccessToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ADMIN_JWT_ACCESS_SECRET = 'test_admin_access_secret_1234567890';
    process.env.ADMIN_JWT_REFRESH_SECRET = 'test_admin_refresh_secret_1234567890';
    process.env.USER_JWT_ACCESS_SECRET = 'test_user_access_secret_1234567890';
    process.env.USER_JWT_REFRESH_SECRET = 'test_user_refresh_secret_1234567890';

    mongo = await MongoMemoryServer.create();
    await connectMongo(mongo.getUri());

    await SettingsModel.updateOne(
      { _id: SETTINGS_SINGLETON_ID },
      {
        $set: {
          _id: SETTINGS_SINGLETON_ID,
          serviceAreas: ['Kathmandu', 'Lalitpur', 'Bhaktapur'],
          deliveryFeeFlat: 20,
          legalAgeMin: 18,
          nightHours: { start: '22:00', end: '06:00', timezone: 'Asia/Kathmandu' }
        }
      },
      { upsert: true }
    );

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
      images: [{ url: 'https://example.com/a.png', publicId: 'p1', format: 'png' }]
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

  it('allows order if kycStatus == rejected but blocks progression', async () => {
    const { token, userId } = await signup('o1@buzzbar.com');
    await UserModel.updateOne({ _id: userId }, { $set: { kycStatus: 'rejected' } });

    const { variantId } = await seedVariant(1000, 5);
    await request(app).post('/api/v1/cart/items').set('Authorization', `Bearer ${token}`).send({ variantId, qty: 1 });

    const create = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ paymentMethod: 'COD', address: { fullAddress: 'Some address', area: 'Kathmandu' } });
    expect(create.status).toBe(201);
    const order = (await OrderModel.findOne({ userId }).lean().exec()) as any;
    expect(order?.status).toBe('CREATED');
    expect(order?.deliveryAgeCheckRequired).toBe(true);
    expect(order?.progressBlockedReason).toBe('KYC_REQUIRED');
  });

  it('allows order if kycStatus == pending and sets delivery age check without blocking progress', async () => {
    const { token, userId } = await signup('o2@buzzbar.com');
    await UserModel.updateOne({ _id: userId }, { $set: { kycStatus: 'pending' } });

    const { variantId } = await seedVariant(1000, 5);
    await request(app).post('/api/v1/cart/items').set('Authorization', `Bearer ${token}`).send({ variantId, qty: 2 });

    const create = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ paymentMethod: 'WALLET', address: { fullAddress: 'Some address', area: 'Kathmandu' } });
    expect(create.status).toBe(201);

    const order = (await OrderModel.findOne({ userId }).lean().exec()) as any;
    expect(order?.status).toBe('CREATED');
    expect(order?.paymentStatus).toBe('PENDING');
    expect(order?.deliveryAgeCheckRequired).toBe(true);
    expect(order?.progressBlockedReason).toBeUndefined();
  });

  it('allows order if kycStatus == not_started and snapshots delivery age check', async () => {
    const { token, userId } = await signup('o2b@buzzbar.com');

    const { variantId } = await seedVariant(1000, 5);
    await request(app).post('/api/v1/cart/items').set('Authorization', `Bearer ${token}`).send({ variantId, qty: 1 });

    const create = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ paymentMethod: 'COD', address: { fullAddress: 'Some address', area: 'Kathmandu' } });
    expect(create.status).toBe(201);

    const order = (await OrderModel.findOne({ userId }).lean().exec()) as any;
    expect(order?.status).toBe('CREATED');
    expect(order?.deliveryAgeCheckRequired).toBe(true);
    expect(order?.progressBlockedReason).toBeUndefined();
  });

  it('rejects COD during configured night window', async () => {
    const tz = 'Asia/Kathmandu';
    const nowMin = getNowMinutesInTz(tz);
    await SettingsModel.updateOne(
      { _id: SETTINGS_SINGLETON_ID },
      { $set: { nightHours: { start: hmFromMinutes(nowMin - 1), end: hmFromMinutes(nowMin + 1), timezone: tz } } }
    );

    const { token, userId } = await signup('o3@buzzbar.com');
    await UserModel.updateOne({ _id: userId }, { $set: { kycStatus: 'verified' } });
    const { variantId } = await seedVariant(1000, 5);
    await request(app).post('/api/v1/cart/items').set('Authorization', `Bearer ${token}`).send({ variantId, qty: 1 });

    const create = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ paymentMethod: 'COD', address: { fullAddress: 'Some address', area: 'Kathmandu' } });
    expect(create.status).toBe(409);
    expect(create.body.errorCode).toBe('NIGHT_HOURS_COD_REJECTED');
  });

  it('rejects service area outside settings', async () => {
    const { token, userId } = await signup('o4@buzzbar.com');
    await UserModel.updateOne({ _id: userId }, { $set: { kycStatus: 'verified' } });
    const { variantId } = await seedVariant(1000, 5);
    await request(app).post('/api/v1/cart/items').set('Authorization', `Bearer ${token}`).send({ variantId, qty: 1 });

    const create = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ paymentMethod: 'WALLET', address: { fullAddress: 'Some address', area: 'Pokhara' } });
    expect(create.status).toBe(409);
    expect(create.body.errorCode).toBe('SERVICE_AREA_NOT_SUPPORTED');
  });

  it('reserves stock, prevents oversell, promo revalidated, snapshots price, cancel releases reserved', async () => {
    // set night window away from now (avoid COD rejection)
    const tz = 'Asia/Kathmandu';
    const nowMin = getNowMinutesInTz(tz);
    const start = nowMin <= 1300 ? hmFromMinutes(nowMin + 120) : hmFromMinutes(nowMin - 180);
    const end = hmFromMinutes((nowMin <= 1300 ? nowMin + 180 : nowMin - 120));
    await SettingsModel.updateOne({ _id: SETTINGS_SINGLETON_ID }, { $set: { nightHours: { start, end, timezone: tz } } });

    const { token, userId } = await signup('o5@buzzbar.com');
    await UserModel.updateOne({ _id: userId }, { $set: { kycStatus: 'verified' } });

    const { variantId } = await seedVariant(999, 2);

    // Other user adds to cart BEFORE reservation happens, to simulate stale cart state.
    const other = await signup('o6@buzzbar.com');
    await UserModel.updateOne({ _id: other.userId }, { $set: { kycStatus: 'verified' } });
    const otherAdd = await request(app)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${other.token}`)
      .send({ variantId, qty: 1 });
    expect(otherAdd.status).toBe(200);

    await request(app).post('/api/v1/cart/items').set('Authorization', `Bearer ${token}`).send({ variantId, qty: 2 });

    await PromotionModel.create({
      code: 'OK10',
      type: 'PERCENT',
      value: 10,
      startAt: new Date('2020-01-01T00:00:00.000Z'),
      endAt: new Date('2099-12-31T00:00:00.000Z'),
      isActive: true
    });

    const create = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ paymentMethod: 'COD', promoCode: 'ok10', address: { fullAddress: 'Some address', area: 'Kathmandu' } });
    expect(create.status).toBe(201);

    const stock = (await InventoryStockModel.findOne({ variantId }).lean().exec()) as any;
    expect(stock?.reserved).toBe(2);

    // oversell attempt by another user should fail at order creation due to reservation
    const fail = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${other.token}`)
      .send({ paymentMethod: 'WALLET', address: { fullAddress: 'Some address', area: 'Kathmandu' } });
    expect(fail.status).toBe(409);
    expect(['OUT_OF_STOCK', 'INSUFFICIENT_STOCK']).toContain(fail.body.errorCode);

    const orderId = create.body.data.orderId as string;
    const detail = await request(app).get(`/api/v1/orders/${orderId}`).set('Authorization', `Bearer ${token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.subtotal).toBe(1998);
    expect(detail.body.data.discount).toBe(199); // floor(10% * 1998)
    expect(detail.body.data.deliveryFee).toBe(20);
    expect(detail.body.data.total).toBe(1819);
    expect(detail.body.data.items[0].unitPrice).toBe(999);

    // change price after order; snapshot remains unchanged
    await VariantModel.updateOne({ _id: variantId }, { $set: { price: 1234 } });
    const detail2 = await request(app).get(`/api/v1/orders/${orderId}`).set('Authorization', `Bearer ${token}`);
    expect(detail2.body.data.items[0].unitPrice).toBe(999);

    // cancel releases reserved
    const cancel = await request(app)
      .post(`/api/v1/admin/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ reason: 'test_cancel' });
    expect(cancel.status).toBe(200);
    const stockAfter = (await InventoryStockModel.findOne({ variantId }).lean().exec()) as any;
    expect(stockAfter?.reserved).toBe(0);
  });

  it('KYC rejection blocks open orders instead of cancelling them', async () => {
    const { token, userId } = await signup('o7@buzzbar.com');

    // Create a pending KYC attempt (AND gate failure) so admin reject is allowed.
    const kyc = await request(app)
      .post('/api/v1/kyc/submit')
      .set('Authorization', `Bearer ${token}`)
      .field('clientDobRaw', '2000-08-01')
      .field('clientConfidence', '0.95')
      .attach('idFront', Buffer.from([0x89, 0x50, 0x4e, 0x47]), { filename: 'server-2000-01-01.png', contentType: 'image/png' });
    expect(kyc.status).toBe(201);
    expect(kyc.body.data.kycStatus).toBe('pending');

    const { variantId } = await seedVariant(500, 3);
    await request(app).post('/api/v1/cart/items').set('Authorization', `Bearer ${token}`).send({ variantId, qty: 1 });

    const create = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ paymentMethod: 'WALLET', address: { fullAddress: 'Some address', area: 'Kathmandu' } });
    expect(create.status).toBe(201);
    const orderId = create.body.data.orderId as string;

    const stock = (await InventoryStockModel.findOne({ variantId }).lean().exec()) as any;
    expect(stock?.reserved).toBe(1);

    const reject = await request(app)
      .post(`/api/v1/admin/kyc/${userId}/reject`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ reason: 'Underage' });
    expect(reject.status).toBe(200);

    const order = (await OrderModel.findById(orderId).lean().exec()) as any;
    expect(order?.status).toBe('CREATED');
    expect(order?.progressBlockedReason).toBe('KYC_REQUIRED');
    expect(order?.deliveryAgeCheckRequired).toBe(true);
    const stockAfter = (await InventoryStockModel.findOne({ variantId }).lean().exec()) as any;
    expect(stockAfter?.reserved).toBe(1);
  });
});
