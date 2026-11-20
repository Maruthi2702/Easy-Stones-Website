import type { Request, Response, NextFunction, RequestHandler } from 'express';
import express from 'express';
import * as db from '../db/cardReceipts/index.ts';
import { CARD_RECEIPTS } from '../utils/cardReceipts.ts';
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

export default function createCardReceiptScanRouter({ authenticate, scanner }: { authenticate: RequestHandler; scanner: ReceiptScanner | null }) {
  const router = express.Router();
  const canUse = (req: Request, res: Response, next: NextFunction) =>
    (has(req, CARD_RECEIPTS.USE) ? next() : res.status(403).json({ message: 'Access denied.' }));

  router.post('/scan', authenticate, canUse, async (req: Request, res: Response) => {
    if (!scanner) return res.status(503).json({ message: 'Reading receipts isn’t set up.' });
    const url = req.body?.url;
    if (typeof url !== 'string' || !(isFilesCdnUrl(url) || isCloudinaryUrl(url))) {
      return res.status(400).json({ message: 'Upload the receipt first.' });
    }
    try {
      const categories = (await db.listCategories()).map((c) => ({ name: String(c.name), label: String(c.label || c.name), active: c.active !== false }));
      const result = await scanner.scan({ url, pdf: isPdfSource(url) }, { categories, today: todayOf() });
      if (!result.ok) return res.status(result.reason === 'failed' ? 502 : 422).json({ message: result.message });
      console.log(`[receipt-scan] ${result.model} read a receipt (${result.usage.input} in / ${result.usage.output} out tokens)`);
      res.json({ scan: result.scan });
    } catch (error) {
      console.error('[receipt-scan] route failed:', error);
      res.status(500).json({ message: 'Couldn’t read this receipt right now.' });
    }
  });

  return router;
}
