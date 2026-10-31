import type { Loose } from '../types/records.ts';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import createPublicProductsRouter from './publicProducts.ts';
import User from '../models/User.ts';
import Role from '../models/Role.ts';
import Customer from '../models/Customer.ts';
import { publicProduct } from '../utils/productView.ts';

let mongo, app;
const secret = 'isolated-product-test-secret';
const customerId = new mongoose.Types.ObjectId();
const staffId = new mongoose.Types.ObjectId();
const product = {
  id: 1, name: 'Stone', collectionType: 'Quartz', image: '/stone.jpg',
  landingCost: 12, price: '$999/sqft', priceLevels: { level1: 20, level2: 30, level3: 40, level4: 0 },
  internalFutureField: 'private', bundles: [{ bundleNumber: 'B1', images: ['/bundle.jpg'] }]
};
const token = (claims: Loose, options: Loose = {}) => jwt.sign(claims, secret, { expiresIn: '1h', ...options });
const get = (session: Loose) => {
  const req = request(app).get('/api/products');
  return session ? req.set('Authorization', `Bearer ${session}`) : req;
};
const safe = (row: Loose) => {
  expect(row).not.toHaveProperty('landingCost');
  expect(row).not.toHaveProperty('priceLevels');
  expect(row).not.toHaveProperty('internalFutureField');
  expect(row).toMatchObject({ id: 1, name: 'Stone', collection: 'Quartz', bundles: product.bundles });
};

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  app = express();
  app.use(cookieParser());
  app.use('/api/products', createPublicProductsRouter({ jwtSecret: secret, getProducts: async () => [product] }));
}, 180000);
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Customer.deleteMany({}), Role.deleteMany({})]);
  await Customer.collection.insertOne({ _id: customerId, priceLevel: 2, isActive: true });
  await User.collection.insertOne({ _id: staffId, role: 'sales_rep', isActive: true, sessionVersion: 2 });
  await Role.collection.insertOne({ name: 'sales_rep', permissions: [] });
});

describe('public catalog field and price access', () => {
  it('anonymous visitors see the catalog without prices, costs or tiers', async () => {
    const res = await get().expect(200);
    safe(res.body[0]);
    expect(res.body[0]).not.toHaveProperty('price');
  });
  it('uses only the customer tier stored in the database, including zero prices', async () => {
    const session = token({ id: String(customerId), type: 'customer', priceLevel: 1 });
    const res = await get(session).expect(200);
    safe(res.body[0]);
    expect(res.body[0].price).toBe('$30.00/sqft');
    await Customer.updateOne({ _id: customerId }, { $set: { priceLevel: 4 } });
    expect((await get(session)).body[0].price).toBe('$0.00/sqft');
    expect(product.landingCost).toBe(12);
    expect(product.priceLevels.level2).toBe(30);
  });
  it('accepts the existing customer cookie', async () => {
    const session = token({ id: String(customerId), type: 'customer' });
    const res = await request(app).get('/api/products').set('Cookie', `customerToken=${session}`).expect(200);
    expect(res.body[0].price).toBe('$30.00/sqft');
  });
  it('invalid, expired, inactive and deleted customer sessions get no price', async () => {
    const claims = { id: String(customerId), type: 'customer' };
    for (const session of ['invalid', token(claims, { expiresIn: -1 })]) {
      expect((await get(session).expect(200)).body[0]).not.toHaveProperty('price');
    }
    await Customer.updateOne({ _id: customerId }, { $set: { isActive: false } });
    expect((await get(token(claims))).body[0]).not.toHaveProperty('price');
    await Customer.deleteMany({});
    expect((await get(token(claims))).body[0]).not.toHaveProperty('price');
  });
  it('staff price access follows live permissions and current sessions', async () => {
    const session = token({ id: String(staffId), type: 'internal', sv: 2, role: 'admin' });
    expect((await get(session)).body[0]).not.toHaveProperty('price');
    await Role.updateOne({ name: 'sales_rep' }, { $set: { permissions: ['view_product_prices'] } });
    const res = await get(session).expect(200);
    safe(res.body[0]);
    expect(res.body[0].price).toBe('$20.00/sqft');
    await User.updateOne({ _id: staffId }, { $inc: { sessionVersion: 1 } });
    expect((await get(session)).body[0]).not.toHaveProperty('price');
  });
  it('admin public reads still never include costs or the tier table', async () => {
    await User.updateOne({ _id: staffId }, { $set: { role: 'admin' } });
    const res = await get(token({ id: String(staffId), type: 'internal', sv: 2 })).expect(200);
    safe(res.body[0]);
    expect(res.body[0].price).toBe('$20.00/sqft');
  });
  it('browser cache projection removes old costs, tiers and personalized prices', () => {
    const cached = publicProduct(product);
    safe(cached);
    expect(cached).not.toHaveProperty('price');
  });
});
