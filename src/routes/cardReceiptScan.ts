import type { Request, Response, NextFunction, RequestHandler } from 'express';
import express from 'express';
import * as db from '../db/cardReceipts/index.ts';
import { CARD_RECEIPTS, isReceiptFolderUrl, privateReceiptNameOf, PRIVATE_RECEIPT_KEY_PREFIX } from '../utils/cardReceipts.ts';
import { getFileStore, type FileStore } from '../services/fileStore.ts';
import rateLimit from 'express-rate-limit';
import { PostgresRateLimitStore } from '../services/rateLimitStore.ts';
import { isCloudinaryUrl, isFilesCdnUrl } from '../utils/fileUrls.ts';
import { isPdfSource } from '../utils/attachments.ts';
import type { ReceiptScanner } from '../services/receiptScan.ts';

/**
 * Credit Card Receipts — reading a receipt (src/utils/receiptScan.ts for the rules).
 *
 *   POST /scan   { url } a receipt the caller just uploaded through /attachments
 *                → { scan } what was read (blank where nothing trustworthy), or
 *                  503 when reading isn't set up (no ANTHROPIC_API_KEY), 422 when it couldn't read it.
 *
 *   app.use('/api/card-receipts', createCardReceiptScanRouter({ authenticate, scanner }));
 *
 * Only files this app stored are read (never a URL someone types), and the
 * answer is only a suggestion: the form fills empty fields and the person checks them.
 */

type ReqUser = { permissions?: string[] };
const has = (req: Request, perm: string) => (((req as Request & { user?: ReqUser }).user || {}).permissions || []).includes(perm);
const todayOf = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

export default function createCardReceiptScanRouter({ authenticate, scanner, fileStore = getFileStore }: { authenticate: RequestHandler; scanner: ReceiptScanner | null; fileStore?: () => FileStore | null }) {
  const router = express.Router();
  const canUse = (req: Request, res: Response, next: NextFunction) =>
    (has(req, CARD_RECEIPTS.USE) ? next() : res.status(403).json({ message: 'Access denied.' }));

  // Each read costs money: a person gets a burst and a day's worth, not an open tap.
  const perPerson = (req: Request) => String((req as Request & { user?: { id?: string; _id?: string } }).user?.id || (req as Request & { user?: { _id?: string } }).user?._id || 'anonymous');
  const burst = rateLimit({ windowMs: 10 * 60 * 1000, limit: 40, keyGenerator: perPerson, store: new PostgresRateLimitStore('receipt-scan-burst'), passOnStoreError: true, standardHeaders: true, legacyHeaders: false, validate: false, message: { message: 'Too many receipts at once. Wait a few minutes.' } });
  const daily = rateLimit({ windowMs: 24 * 60 * 60 * 1000, limit: 200, keyGenerator: perPerson, store: new PostgresRateLimitStore('receipt-scan-daily'), passOnStoreError: true, standardHeaders: true, legacyHeaders: false, validate: false, message: { message: 'Today’s reading limit is reached. Type the details instead.' } });

  const readIt = async (source: Parameters<ReceiptScanner['scan']>[0], res: Response) => {
    try {
      const categories = (await db.listCategories()).map((c) => ({ name: String(c.name), label: String(c.label || c.name), active: c.active !== false }));
      const result = await scanner!.scan(source, { categories, today: todayOf() });
      if (!result.ok) return res.status(result.reason === 'failed' ? 502 : 422).json({ message: result.message });
      console.log(`[receipt-scan] ${result.model} read a receipt (${result.usage.input} in / ${result.usage.output} out tokens)`);
      return res.json({ scan: result.scan });
    } catch (error) {
      console.error('[receipt-scan] route failed:', error);
      return res.status(500).json({ message: 'Couldn’t read this receipt right now.' });
    }
  };

  router.post('/scan', authenticate, canUse, burst, daily, async (req: Request, res: Response) => {
    if (!scanner) return res.status(503).json({ message: 'Reading receipts isn’t set up.' });
    const url = req.body?.url;
    // A private receipt: the file is read here and sent as bytes (the reader can't open our address), and only by whoever uploaded it.
    const privateName = privateReceiptNameOf(url);
    if (privateName) {
      const file = await fileStore()?.get(`${PRIVATE_RECEIPT_KEY_PREFIX}${privateName}`);
      const me = String((req as Request & { user?: { id?: string; _id?: string } }).user?.id || (req as Request & { user?: { _id?: string } }).user?._id || '');
      if (!file || file.metadata.uploader !== me) return res.status(400).json({ message: 'Upload the receipt first.' });
      const mediaType = file.contentType;
      if (!/^(image\/(jpeg|png|gif|webp)|application\/pdf)$/.test(mediaType)) return res.status(422).json({ message: 'Couldn’t read this receipt.' });
      return readIt({ data: file.body.toString('base64'), mediaType: mediaType as 'image/webp' }, res);
    }
    if (typeof url !== 'string' || !(isFilesCdnUrl(url) || isCloudinaryUrl(url)) || !isReceiptFolderUrl(url)) {
      return res.status(400).json({ message: 'Upload the receipt first.' });
    }
    return readIt({ url, pdf: isPdfSource(url) }, res);
  });

  return router;
}
