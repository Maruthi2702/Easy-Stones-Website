// Real server, authentication, permissions and dashboard aggregations against
// a throwaway database. The child has no .env or external service credentials;
// only the unrelated permit polling job is disabled.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { io } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import User from '../models/User.ts';
import Role from '../models/Role.ts';
import Customer from '../models/Customer.ts';
import Schedule from '../models/Schedule.ts';
import { signStaffSession } from '../services/staffSession.ts';
import type { Loose } from '../types/records.ts';

let mongo: MongoMemoryServer | undefined;
let backend: ChildProcess | undefined;
let directory = '', origin = '', output = '';
const secret = 'dashboard-isolated-integration-secret';
const users: Record<string, Loose> = {};
const allNames = ['global', 'manager', 'multiManager', 'wildcard', 'seattle', 'dallas', 'atlanta', 'cross', 'inactive'];
const seattleNames = ['manager', 'multiManager', 'seattle', 'cross', 'inactive'];
const multiNames = [...seattleNames, 'dallas'];
let customerId = '';
const query = { timeRange: '1day', localDate: '2026-11-05' };
const read = async (path: string, who: string, params: Record<string, string> = {}) => {
    const response = await fetch(`${origin}/api/${path}?${new URLSearchParams({ ...query, ...params })}`, {
        headers: { Authorization: `Bearer ${signStaffSession(users[who], secret)}` }
    });
    return { status: response.status, body: await response.json() as Loose };
};
const authorNames = (rows: Loose[], field = 'createdBy') => rows.map(row => allNames.find(name => String(users[name]._id) === String(row[field] || row.createdBy))).sort();

beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    directory = await mkdtemp(join(tmpdir(), 'easy-stones-dashboard-'));
    const preload = join(directory, 'isolate.mjs');
    await writeFile(preload, `
import { registerHooks } from 'node:module';
registerHooks({ load(url, context, next) {
    if (url.endsWith('/src/permits/sync.ts')) return {
        format: 'module', shortCircuit: true,
        source: 'export function createPermitSync() { return { start() {} }; }'
    };
    return next(url, context);
} });
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('External network disabled in dashboard test');
    return originalFetch(input, init);
};
`);
    const socket = createServer();
    socket.listen(0, '127.0.0.1');
    await once(socket, 'listening');
    const port = (socket.address() as import('node:net').AddressInfo).port;
    await new Promise<void>((resolveClose, reject) => socket.close(error => error ? reject(error) : resolveClose()));
    origin = `http://127.0.0.1:${port}`;
    backend = spawn(process.execPath, ['--import', preload, resolve('server.ts')], {
        cwd: directory,
        env: { PATH: process.env.PATH, NODE_ENV: 'test', PORT: String(port), MONGO_URI: mongo.getUri(), JWT_SECRET: secret },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    await new Promise<void>((ready, reject) => {
        const timer = setTimeout(() => reject(new Error(`Isolated server failed to start: ${output.slice(-4000)}`)), 45000);
        const record = (chunk: Buffer) => {
            output += String(chunk);
            if (output.includes(`Backend server running on port ${port}`)) { clearTimeout(timer); ready(); }
        };
        backend!.stdout!.on('data', record);
        backend!.stderr!.on('data', record);
        backend!.once('error', error => { clearTimeout(timer); reject(error); });
        backend!.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${output.slice(-4000)}`)); });
    });
    await Role.insertMany([
        { name: 'qa_global', displayName: 'Test global', permissions: ['view_dashboard', 'view_all_visits', 'view_team_calendar', 'add_visits', 'edit_all_visits', 'delete_all_visits'] },
        { name: 'qa_branch', displayName: 'Test branch', permissions: ['view_dashboard', 'view_branch_visits', 'view_team_calendar'] },
        { name: 'qa_own', displayName: 'Test own', permissions: ['view_dashboard', 'add_visits', 'edit_own_visits', 'delete_own_visits'] },
        { name: 'qa_none', displayName: 'Test no dashboard', permissions: [] }
    ]);
    const assignments: Record<string, string[]> = {
        global: ['*'], manager: ['Seattle'], multiManager: ['Seattle', 'Dallas'], wildcard: ['*'],
        seattle: ['Seattle'], dallas: ['Dallas'], atlanta: ['Atlanta'], cross: ['Dallas', 'Seattle'], inactive: ['Seattle']
    };
    await User.collection.insertMany(allNames.map(name => {
        const user = {
            _id: new mongoose.Types.ObjectId(), username: `qa_${name.toLowerCase()}`, displayName: `Test ${name}`,
            password: 'unused-test-password', role: name === 'global' ? 'qa_global' : ['manager', 'multiManager', 'wildcard'].includes(name) ? 'qa_branch' : 'qa_own',
            location: assignments[name][0] === '*' ? 'Seattle' : assignments[name][0], assignedLocations: assignments[name],
            isActive: name !== 'inactive', sessionVersion: 0
        };
        users[name] = user;
        return user;
    }));
    const documents = allNames.map((name, index) => ({
        _id: new mongoose.Types.ObjectId(), company: `${name} cross-branch customer`, contactName: 'Test Contact', email: `${name.toLowerCase()}@dashboard.example`,
        // Deliberately opposite the logger's branch: access must follow the REP.
        location: assignments[name].includes('Seattle') ? 'Atlanta' : 'Seattle',
        visits: [
            { _id: new mongoose.Types.ObjectId(), createdBy: index % 2 ? users[name]._id : String(users[name]._id), createdByName: `Test ${name}`, date: '2026-11-05', purpose: 'Quick Note', notes: name, followUp: 'Call back', followUpDate: '2026-11-06' },
            { _id: new mongoose.Types.ObjectId(), createdBy: String(users[name]._id), date: '2026-10-01', notes: 'Historical visit' }
        ],
        resources: [{ _id: new mongoose.Types.ObjectId(), title: `${name} samples`, date: '2026-11-05', resourceType: 'Samples', description: name,
            ...(index % 2 ? { createdBy: users[name]._id } : { uploadedBy: String(users[name]._id) }) }]
    }));
    customerId = String(documents[4]._id);
    await Customer.collection.insertMany(documents);
    await Schedule.collection.insertMany(allNames.map(name => ({
        userId: users[name]._id, customerId: new mongoose.Types.ObjectId(customerId), title: `${name} stop`, startTime: '2026-11-05T09:00:00.000', endTime: '2026-11-05T09:30:00.000', status: 'Scheduled'
    })));
}, 60000);

afterAll(async () => {
    if (backend && backend.exitCode === null) {
        const exited = once(backend, 'exit');
        backend.kill('SIGTERM');
        await exited;
    }
    await mongoose.disconnect();
    await mongo?.stop();
    if (directory) await rm(directory, { recursive: true, force: true });
}, 15000);

describe('real dashboard multi-location access and totals', () => {
    it.each([
        ['global', allNames], ['manager', seattleNames], ['multiManager', multiNames], ['wildcard', allNames], ['seattle', ['seattle']]
    ] as [string, string[]][])('%s receives only their allowed reps and matching totals', async (who, expected) => {
        const [visits, resources, stats, followups, panel] = await Promise.all([
            read('dashboard/visits', who), read('dashboard/resources', who), read('dashboard/stats', who),
            read('dashboard/followups', who), read('dashboard/followups/panel', who)
        ]);
        for (const answer of [visits, resources, stats, followups, panel]) expect(answer.status).toBe(200);
        expect(authorNames(visits.body as Loose[])).toEqual([...expected].sort());
        expect(authorNames(resources.body as Loose[], 'uploadedBy')).toEqual([...expected].sort());
        expect(authorNames(followups.body.rows)).toEqual([...expected].sort());
        expect((panel.body as Loose[]).every(row => expected.includes(String(row.by).replace('Test ', '')))).toBe(true);
        expect(stats.body).toMatchObject({ visits: expected.length, resources: expected.length, followUp: expected.length });
    });

    it.each(['manager', 'seattle'])('%s cannot widen access through forged location or rep queries', async who => {
        for (const path of ['dashboard/visits', 'dashboard/resources', 'dashboard/stats', 'dashboard/followups', 'dashboard/followups/panel']) {
            const answer = await read(path, who, { reps: String(users.atlanta._id), location: 'Atlanta' });
            expect(answer.status).toBe(200);
            if (path.endsWith('stats')) expect(answer.body).toMatchObject({ visits: 0, resources: 0, followUp: 0 });
            else expect(path.endsWith('followups') ? answer.body.rows : answer.body).toEqual([]);
        }
    });

    it('combines multiple selected reps and intersects a selected location', async () => {
        const reps = ['seattle', 'dallas', 'cross'].map(name => String(users[name]._id)).join(',');
        const all = await read('dashboard/visits', 'global', { reps });
        expect(authorNames(all.body as Loose[])).toEqual(['cross', 'dallas', 'seattle']);
        const location = await read('dashboard/visits', 'global', { reps, location: 'Dallas' });
        expect(authorNames(location.body as Loose[])).toEqual(['cross', 'dallas']);
        const restricted = await read('dashboard/visits', 'manager', { reps });
        expect(authorNames(restricted.body as Loose[])).toEqual(['cross', 'seattle']);
    });

    it('uses the same rep scope for all-time and custom ranges', async () => {
        const all = await read('dashboard/visits', 'manager', { timeRange: 'all' });
        expect((all.body as Loose[])).toHaveLength(seattleNames.length * 2);
        const custom = await read('dashboard/visits', 'manager', { timeRange: 'custom', from: '2026-10-01', to: '2026-10-01' });
        expect(authorNames(custom.body as Loose[])).toEqual([...seattleNames].sort());
        const stats = await read('dashboard/stats', 'manager', { timeRange: 'custom', from: '2026-10-01', to: '2026-10-01' });
        expect(stats.body).toMatchObject({ visits: seattleNames.length, resources: 0, followUp: 0 });
    });

    it('keeps concurrent users and branches isolated', async () => {
        const cases = [['manager', seattleNames], ['multiManager', multiNames], ['dallas', ['dallas']], ['atlanta', ['atlanta']]] as [string, string[]][];
        await Promise.all(cases.flatMap(([who, names]) => Array.from({ length: 3 }, async () => {
            const answer = await read('dashboard/visits', who, { timeRange: 'all' });
            expect(answer.status).toBe(200);
            expect([...new Set(authorNames(answer.body as Loose[]))]).toEqual([...names].sort());
        })));
    });

    it('reflects staff branch reassignment on the next request', async () => {
        await User.collection.updateOne({ _id: users.dallas._id }, { $set: { assignedLocations: ['Seattle'], location: 'Seattle' } });
        try {
            const answer = await read('dashboard/visits', 'manager');
            expect(authorNames(answer.body as Loose[])).toEqual([...seattleNames, 'dallas'].sort());
        } finally {
            await User.collection.updateOne({ _id: users.dallas._id }, { $set: { assignedLocations: ['Dallas'], location: 'Dallas' } });
        }
    });

    it('refuses anonymous, website-customer, inactive and unpermitted sessions', async () => {
        const customerToken = jwt.sign({ id: customerId, type: 'customer' }, secret);
        await User.collection.updateOne({ _id: users.seattle._id }, { $set: { role: 'qa_none' } });
        try {
            for (const path of ['stats', 'visits', 'resources', 'followups', 'followups/panel']) {
                expect((await fetch(`${origin}/api/dashboard/${path}`)).status).toBe(401);
                expect((await fetch(`${origin}/api/dashboard/${path}`, { headers: { Authorization: `Bearer ${customerToken}` } })).status).toBe(403);
                expect((await read(`dashboard/${path}`, 'inactive')).status).toBe(401);
                expect((await read(`dashboard/${path}`, 'seattle')).status).toBe(403);
            }
        }
        finally { await User.collection.updateOne({ _id: users.seattle._id }, { $set: { role: 'qa_own' } }); }
    });

    it('applies the same branch and rep restrictions to the team calendar', async () => {
        const manager = await read('schedule', 'manager', { scope: 'team', start: '2026-11-05T00:00:00.000', end: '2026-11-05T23:59:59.999' });
        expect(manager.status).toBe(200);
        expect(authorNames(manager.body as Loose[], 'userId')).toEqual([...seattleNames].sort());
        const forged = await read('schedule', 'manager', { scope: 'team', reps: String(users.atlanta._id) });
        expect(forged.status).toBe(200);
        expect(forged.body).toEqual([]);
        const own = await read('schedule', 'seattle', { scope: 'team' });
        expect(authorNames(own.body as Loose[], 'userId')).toEqual(['seattle']);
    });

    it('publishes a refresh event when another rep adds, edits, completes or deletes a visit', async () => {
        const socket = io(origin, { transports: ['websocket'], auth: { token: signStaffSession(users.global, secret) } });
        await new Promise<void>((connected, reject) => {
            socket.once('connect', connected); socket.once('connect_error', reject);
        });
        const updates: string[] = [];
        socket.on('customer_update', () => updates.push('changed'));
        const write = async (method: string, path: string, body?: unknown) => fetch(`${origin}/api/${path}`, {
            method, headers: { Authorization: `Bearer ${signStaffSession(users.seattle, secret)}`, 'Content-Type': 'application/json' },
            ...(body ? { body: JSON.stringify(body) } : {})
        });
        try {
            const added = await write('POST', `customers/${customerId}/visits`, { date: '2026-11-05', purpose: 'Unscheduled in Person Sales Call', notes: 'Team update', followUp: 'Call', followUpDate: '2026-11-06' });
            expect(added.status).toBe(201);
            const { visit } = await added.json();
            await expect.poll(() => updates.length).toBe(1);
            expect((await write('PUT', `customers/${customerId}/visits/${visit._id}`, { notes: 'Team update edited' })).status).toBe(200);
            await expect.poll(() => updates.length).toBe(2);
            expect((await write('PATCH', `customers/${customerId}/visits/${visit._id}/follow-up`, { action: 'done', today: '2026-11-05' })).status).toBe(200);
            await expect.poll(() => updates.length).toBe(3);
            const deleted = await write('DELETE', `customers/${customerId}/visits/${visit._id}`);
            expect(deleted.status, `${await deleted.text()}\n${output.slice(-3000)}`).toBe(200);
            await expect.poll(() => updates.length).toBe(4);
        } finally { socket.disconnect(); }
    });
});
