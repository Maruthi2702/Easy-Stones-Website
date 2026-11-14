/**
 * Does the Daily Report answer the same from Postgres as from MongoDB, on real data?
 *
 *   node --env-file=.env scripts/pg-compare-daily-reports.ts
 *
 * Reads MongoDB only (MONGO_URI). Postgres is PGlite in memory (never RDS). GET requests through the
 * real router, as a branch login and an admin: every saved day (the sheet with what it derives, its
 * log, the PDF's status), every month with reports (the list and the CSV, per branch and for all),
 * the overview of each day, the submitted-days check, and the Payments page's lock reads. Deliveries,
 * check-ins and payments stay on MongoDB in both runs, so what a sheet derives is the same by
 * construction. Exit 0 = the same.
 */
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import { openDb, migrateDb } from '../src/db/client.ts';
import { copyFromMongo } from '../src/db/copy/plan.ts';
import { readMongo } from '../src/db/copy/readMongo.ts';
import { useAppDbForTests } from '../src/db/appDb.ts';
import { normalize, diffEntries, describeDifference } from '../src/db/customers/parity.ts';
import createDailyReportsRouter from '../src/routes/dailyReports.ts';
import { isDaySubmitted, reportDayStatus } from '../src/db/dailyReports/index.ts';
import type { Loose } from '../src/types/records.ts';

const mongoUri = process.env.MONGO_URI;
if (!mongoUri) { console.error('MONGO_URI is not set.'); process.exit(1); }
const DAY_LIMIT = Number(process.env.DAYS || 400);

const pg = await openDb('pglite:memory');
await migrateDb(pg.db, 'pglite:memory');
console.log('Reading MongoDB and copying into memory …');
const source = await readMongo(mongoUri, 'pg-compare-daily-reports');
const report = await copyFromMongo(pg.db, source, { write: true });
console.log(`Copied ${Object.values(report.tables).reduce((a, b) => a + b, 0)} rows (${report.problems.length} problems reported by the copy).`);
useAppDbForTests(pg.db);
await mongoose.connect(mongoUri, { readPreference: 'secondaryPreferred', appName: 'pg-compare-daily-reports', autoIndex: false, autoCreate: false });

const saved: Loose[] = [...source.dailyReports].sort((a, b) => String(b.date).localeCompare(String(a.date)));
const days = saved.slice(0, DAY_LIMIT);
const months = [...new Set(saved.map(d => String(d.date).slice(0, 7)))].sort();
const branches = [...new Set(saved.map(d => String(d.location)))].sort();
console.log(`${saved.length} saved reports, ${branches.length} branches, ${months.length} months; sheets compared for the newest ${days.length}.`);

const has = (req: Loose, p: string) => (req.user.permissions || []).includes(p);
const app = express();
app.use(express.json());
app.use('/api/daily-reports', createDailyReportsRouter({
  authenticate: (req: Loose, _res: Loose, next: () => void) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); },
  requirePermission: (p: string) => (req: Loose, res: Loose, next: () => void) => (has(req, p) ? next() : res.status(403).json({}))
}));

const VIEW = ['view_daily_report'];
const admin = { username: 'admin', permissions: VIEW, assignedLocations: ['*'] };
const atBranch = (b: string) => ({ username: `at-${b}`, permissions: VIEW, assignedLocations: [b] });

const together = process.env.TOGETHER === '1';
const setDb = (database: 'mongo' | 'postgres') => {
  const v = database === 'postgres' ? 'postgres' : '';
  process.env.DB_DAILY_REPORTS = v;
  if (together) process.env.DB_PAYMENTS = process.env.DB_CHECKIN = v;
};
const asked = async (database: 'mongo' | 'postgres', user: Loose, url: string, binary: boolean) => {
  setDb(database);
  const r = await request(app).get(url).set('x-test-user', JSON.stringify(user));
  return { status: r.status, type: r.headers['content-type'], body: binary ? undefined : (r.body && Object.keys(r.body).length ? r.body : r.text) };
};

/** MongoDB leaves reports of one day (and submitted-days) in no set order; Postgres lists them by branch. */
const byDayThenBranch = (x: Loose, y: Loose) => String(y.date).localeCompare(String(x.date)) || String(x.location).localeCompare(String(y.location));
const sortReports = (b: Loose) => b && typeof b === 'object'
  ? { ...b, ...(Array.isArray(b.reports) ? { reports: [...b.reports].sort(byDayThenBranch) } : {}), ...(Array.isArray(b.days) ? { days: [...b.days].sort(byDayThenBranch) } : {}) } : b;

let checked = 0, differences = 0;
const problems: string[] = [];
const compare = async (user: Loose, url: string, binary = false) => {
  checked++;
  const [m, p] = [await asked('mongo', user, url, binary), await asked('postgres', user, url, binary)];
  if (m.status !== p.status || m.type !== p.type) { problems.push(`${user.username} ${url}: status ${m.status} vs ${p.status}`); differences++; return; }
  for (const d of diffEntries(normalize(sortReports(m.body)), normalize(sortReports(p.body)), 200)) {
    if (problems.length < 400) problems.push(`${user.username} ${url}: ${describeDifference(d)}`);
    differences++;
  }
};

console.log('Sheets, logs and PDFs …');
for (const d of days) {
  const q = `location=${encodeURIComponent(d.location)}`;
  await compare(atBranch(d.location), `/api/daily-reports/${d.date}?${q}`);
  await compare(atBranch(d.location), `/api/daily-reports/${d.date}/log?${q}`);
}
for (const d of days.slice(0, 20)) await compare(atBranch(d.location), `/api/daily-reports/${d.date}/pdf?location=${encodeURIComponent(d.location)}`, true);

console.log('Months …');
for (const month of months) {
  await compare(admin, `/api/daily-reports?month=${month}&location=all`);
  await compare(admin, `/api/daily-reports/export/${month}?location=all`);
  for (const b of branches) {
    await compare(atBranch(b), `/api/daily-reports?month=${month}&location=${encodeURIComponent(b)}`);
    await compare(atBranch(b), `/api/daily-reports/export/${month}?location=${encodeURIComponent(b)}`);
  }
}

console.log('Overview, submitted days and the Payments lock …');
const dates = [...new Set(days.map(d => String(d.date)))];
for (const date of dates.slice(0, 60)) await compare(admin, `/api/daily-reports/overview/${date}`);
for (let i = 0; i < days.length; i += 10) {
  const pairs = days.slice(i, i + 10).map(d => `${d.location}|${d.date}`).join(',');
  await compare(admin, `/api/daily-reports/submitted-days?days=${encodeURIComponent(pairs)}`);
}
for (const d of days) {
  checked++;
  const read = async (database: 'mongo' | 'postgres') => {
    setDb(database);
    const s = await reportDayStatus(d.location, d.date);
    return { locked: await isDaySubmitted(d.location, d.date), status: s && { status: s.status, by: s.submittedBy || '', at: s.submittedAt, auto: Boolean(s.autoSubmitted) } };
  };
  for (const e of diffEntries(normalize(await read('mongo')), normalize(await read('postgres')), 20)) {
    problems.push(`lock ${d.location} ${d.date}: ${describeDifference(e)}`); differences++;
  }
}

console.log(`\n${checked} requests compared.`);
console.log(`${differences} differences.`);
for (const line of problems.slice(0, 60)) console.log(' -', line);
await mongoose.disconnect();
await pg.close();
process.exit(differences ? 1 : 0);
