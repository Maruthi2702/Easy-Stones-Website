import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io as connect } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import User from '../models/User.js';
import Role from '../models/Role.js';
import { resolveStaffToken } from './staffIdentity.js';
import { registerBranchRoomJoins } from './socketAccess.js';

let mongo, server, io, url;
const clients = [];
const secret = 'isolated-socket-test-secret';
const id = new mongoose.Types.ObjectId();
const token = (claims = {}, options = {}) => jwt.sign({ id: String(id), type: 'internal', sv: 2, ...claims }, secret, { expiresIn: '1h', ...options });
async function client() {
  const socket = connect(url, { transports: ['websocket'], forceNew: true });
  clients.push(socket);
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  return socket;
}
const join = (socket, session = token(), event = 'join_delivery_rooms') => socket.timeout(2000).emitWithAck(event, { token: session });
const rooms = socket => [...io.sockets.sockets.get(socket.id).rooms].filter(room => room.includes('-location:'));

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  server = createServer(); io = new Server(server);
  io.on('connection', socket => registerBranchRoomJoins(socket, { resolveStaff: session => resolveStaffToken(session, secret) }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}`;
}, 180000);
afterAll(async () => {
  await new Promise(resolve => io.close(resolve));
  await mongoose.disconnect(); await mongo?.stop();
});
beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Role.deleteMany({})]);
  await User.collection.insertOne({ _id: id, role: 'test_staff', assignedLocations: ['Seattle'], sessionVersion: 2, isActive: true });
  await Role.collection.insertOne({ name: 'test_staff', permissions: [] });
});
afterEach(() => { for (const socket of clients.splice(0)) socket.disconnect(); });

describe('branch socket authorization', () => {
  it('staff without delivery permission cannot receive delivery payloads', async () => {
    const socket = await client();
    expect(await join(socket)).toEqual({ ok: false });
    expect(rooms(socket)).toEqual([]);
  });
  it('delivery viewers and drivers join only assigned branches', async () => {
    await Role.updateOne({ name: 'test_staff' }, { $set: { permissions: ['view_delivery_schedule', 'delivery_driver_view'] } });
    const socket = await client();
    expect(await join(socket)).toEqual({ ok: true });
    expect(rooms(socket)).toEqual(['delivery-location:Seattle']);
    const received = new Promise(resolve => socket.once('delivery_update', resolve));
    io.to('delivery-location:Seattle').emit('delivery_update', { type: 'upsert', delivery: { customerName: 'Test customer' } });
    expect(await received).toMatchObject({ delivery: { customerName: 'Test customer' } });
    expect(await join(socket, token(), 'join_checkin_rooms')).toEqual({ ok: false });
    expect(rooms(socket)).toEqual(['delivery-location:Seattle']);
  });
  it('preserves all-branch viewers and legacy staff sessions', async () => {
    await Role.updateOne({ name: 'test_staff' }, { $set: { permissions: ['view_delivery_schedule'] } });
    await User.updateOne({ _id: id }, { $set: { assignedLocations: ['*'] } });
    const socket = await client();
    const legacy = jwt.sign({ userId: String(id), sv: 2 }, secret, { expiresIn: '1h' });
    expect(await join(socket, legacy)).toEqual({ ok: true });
    expect(rooms(socket)).toEqual(['delivery-location:*']);
  });
  it('invalid, expired, customer, revoked and temporary-password tokens cannot join', async () => {
    await Role.updateOne({ name: 'test_staff' }, { $set: { permissions: ['view_delivery_schedule'] } });
    const socket = await client();
    for (const session of [null, 'invalid', token({}, { expiresIn: -1 }), token({ type: 'customer' }), token({ sv: 1 })]) {
      expect(await join(socket, session)).toEqual({ ok: false });
      expect(rooms(socket)).toEqual([]);
    }
    await User.updateOne({ _id: id }, { $set: { mustChangePassword: true } });
    expect(await join(socket)).toEqual({ ok: false });
    await User.updateOne({ _id: id }, { $set: { mustChangePassword: false, isActive: false } });
    expect(await join(socket)).toEqual({ ok: false });
  });
  it('rejoining after permission removal or logout clears existing rooms', async () => {
    await Role.updateOne({ name: 'test_staff' }, { $set: { permissions: ['view_delivery_schedule', 'view_checkins'] } });
    const socket = await client();
    await join(socket); await join(socket, token(), 'join_checkin_rooms');
    expect(rooms(socket)).toHaveLength(2);
    await Role.updateOne({ name: 'test_staff' }, { $set: { permissions: [] } });
    expect(await join(socket)).toEqual({ ok: false });
    expect(rooms(socket)).toEqual(['checkin-location:Seattle']);
    expect(await join(socket, null, 'join_checkin_rooms')).toEqual({ ok: false });
    expect(rooms(socket)).toEqual([]);
  });
  it('a late authorization response cannot restore an old account’s rooms', async () => {
    const handlers = new Map();
    const socket = { connected: true, rooms: new Set(), on: (event, fn) => handlers.set(event, fn),
      join: room => socket.rooms.add(room), leave: room => socket.rooms.delete(room) };
    let resolveOld;
    registerBranchRoomJoins(socket, { resolveStaff: session => session === 'old'
      ? new Promise(resolve => { resolveOld = resolve; }) : null });
    const oldJoin = handlers.get('join_delivery_rooms')({ token: 'old' });
    await handlers.get('join_delivery_rooms')({ token: null });
    resolveOld({ permissions: ['view_delivery_schedule'], assignedLocations: ['Seattle'] });
    await oldJoin;
    expect([...socket.rooms]).toEqual([]);
  });
});
