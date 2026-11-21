import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import type { ReceiptScanner, ReceiptSource } from '../services/receiptScan.ts';

vi.mock('../db/cardReceipts/index.ts', () => ({
  listCategories: async () => [
    { _id: 'a', name: 'fuel', label: 'Fuel', active: true },
    { _id: 'b', name: 'old_one', label: 'Old one', active: false }
  ]
}));

const { default: createCardReceiptScanRouter } = await import('./cardReceiptScan.ts');

const CDN = 'https://d111.cloudfront.net';
process.env.FILES_CDN_URL = CDN;

const scanned = vi.fn();
const fakeScanner = (result: Awaited<ReturnType<ReceiptScanner['scan']>>): ReceiptScanner => ({
  model: 'test',
  scan: async (source: ReceiptSource, opts) => { scanned(source, opts); return result; }
});
const READ = { isReceipt: true, date: '2026-11-18', merchant: 'Chevron', totalCents: 6497, subtotalCents: null, taxCents: null, tipCents: null, category: 'fuel' };

function appWith(scanner: ReceiptScanner | null, permissions = ['use_card_receipts']) {
  const app = express();
  app.use(express.json());
  const authenticate = (req: Request, _res: Response, next: NextFunction) => { (req as Request & { user: unknown }).user = { id: 'u1', permissions }; next(); };
  app.use('/api/card-receipts', createCardReceiptScanRouter({ authenticate, scanner }));
  return app;
}

describe('POST /api/card-receipts/scan', () => {
  beforeEach(() => scanned.mockReset());

  it('reads a stored photo and answers what was read', async () => {
    const res = await request(appWith(fakeScanner({ ok: true, scan: READ, usage: { input: 1, output: 1 }, model: 'test' })))
      .post('/api/card-receipts/scan').send({ url: `${CDN}/CardReceipts/r1.jpg` });
    expect(res.status).toBe(200);
    expect(res.body.scan).toEqual(READ);
    const [source, opts] = scanned.mock.calls[0];
    expect(source).toEqual({ url: `${CDN}/CardReceipts/r1.jpg`, pdf: false });
    expect(opts.categories.map((c: { name: string }) => c.name)).toEqual(['fuel', 'old_one']);
    expect(opts.categories[1].active).toBe(false);
  });

  it('sends a PDF as a document', async () => {
    await request(appWith(fakeScanner({ ok: true, scan: READ, usage: { input: 1, output: 1 }, model: 'test' })))
      .post('/api/card-receipts/scan').send({ url: `${CDN}/CardReceipts/invoice.pdf` });
    expect(scanned.mock.calls[0][0]).toEqual({ url: `${CDN}/CardReceipts/invoice.pdf`, pdf: true });
  });

  it('never reads a URL the app did not store', async () => {
    for (const url of ['https://evil.example.com/r.jpg', 'https://other.cloudfront.net/r.jpg', `${CDN}/Visits/visit.jpg`, `${CDN}/team-files/contract.pdf`, '', 42]) {
      const res = await request(appWith(fakeScanner({ ok: true, scan: READ, usage: { input: 1, output: 1 }, model: 'test' })))
        .post('/api/card-receipts/scan').send({ url });
      expect(res.status).toBe(400);
    }
    expect(scanned).not.toHaveBeenCalled();
  });

  it('needs the My receipts switch', async () => {
    const res = await request(appWith(fakeScanner({ ok: true, scan: READ, usage: { input: 1, output: 1 }, model: 'test' }), []))
      .post('/api/card-receipts/scan').send({ url: `${CDN}/CardReceipts/r1.jpg` });
    expect(res.status).toBe(403);
  });

  it('answers 503 when reading is not set up', async () => {
    const res = await request(appWith(null)).post('/api/card-receipts/scan').send({ url: `${CDN}/CardReceipts/r1.jpg` });
    expect(res.status).toBe(503);
  });

  it('answers 422 when the receipt could not be read, 502 when the call failed', async () => {
    const unreadable = await request(appWith(fakeScanner({ ok: false, reason: 'unreadable', message: 'Couldn’t read this receipt.' })))
      .post('/api/card-receipts/scan').send({ url: `${CDN}/CardReceipts/r1.jpg` });
    expect(unreadable.status).toBe(422);
    const failed = await request(appWith(fakeScanner({ ok: false, reason: 'failed', message: 'Couldn’t read this receipt right now.' })))
      .post('/api/card-receipts/scan').send({ url: `${CDN}/CardReceipts/r1.jpg` });
    expect(failed.status).toBe(502);
  });
});
