/**
 * Inventory Analysis — stock levels, aging, and reorder signals from SPS's
 * exports. Moved out of server.ts: a self-contained feature with its own
 * models, handed the middleware it needs, same pattern as the deliveries,
 * daily-reports and schedule routers. Mounted at /api/inventory-analysis, so
 * every path below is relative to that.
 *
 * Imports announce themselves with the 'inventory_analysis_update' socket
 * event (req.app.get('io')), which SalesPage.jsx uses to refresh open tabs
 * and clear their remembered answers (src/api/inventoryAnalysisCache.js).
 */
import express from 'express';
import type { Request, RequestHandler } from 'express';
import type { Multer } from 'multer';
import type { parseInventorySalesWorkbook } from '../utils/inventoryImport.ts';

// Authentication request fields are declared centrally in src/types/server.ts.
import type {} from '../types/server.ts';
import { randomUUID, createHash } from 'crypto';
import { publishTransitReport } from '../services/inventoryTransitImport.ts';
import { validDay } from '../purchasing/planning.ts';
import { reportIdentity } from '../purchasing/reportIdentity.ts';
import { PurchasingScope } from '../purchasing/models.ts';
import { importInventoryStock } from '../services/inventoryStockImport.ts';
import { stockSummary, stockFilterValues, listStockItems, stockGroups, velocityInputs, replaceSalesPeriod } from '../db/inventory/index.ts';
import { listActiveShipments } from '../db/inventoryTransit/index.ts';
import { areaOn } from '../db/appDb.ts';
import { rekeyScopeCohorts } from '../db/purchasing/rekey.ts';
import { groupTransitShipments } from '../utils/inventoryTransitImport.ts';
import { SLAB_STATUS_BUCKET } from '../utils/inventoryStatus.ts';
// Parses run in a worker thread — see runWorkbookParse.ts for why an uploaded
// file needs that isolation.
import { runWorkbookParse } from '../utils/runWorkbookParse.ts';
import type { WorkbookParseResults } from '../utils/runWorkbookParse.ts';
// Big writes go in batches that survive a dropped database connection.

/**
 * @param {object} deps
 * @param {Function} deps.authenticate - server.ts's auth middleware
 * @param {Function} deps.requirePermission - server.ts's permission middleware
 * @param {object} deps.uploadMemory - server.ts's in-memory multer instance
 */
interface InventoryRouterDependencies {
  authenticate: RequestHandler;
  requirePermission: (permission: string) => RequestHandler;
  uploadMemory: Multer;
}

export default function createInventoryAnalysisRouter({ authenticate, requirePermission, uploadMemory }: InventoryRouterDependencies) {
  const router = express.Router();

  // Two SPS exports feed this feature (see src/utils/inventoryImport.ts):
  // - "stock": a full mirror of on-hand slabs/lots, wiped and replaced whole on
  //   every import since it's a point-in-time snapshot, not a ledger.
  // - "sales": per-product sold totals for a location+date-range period, kept
  //   alongside prior periods (re-importing the same period+location replaces
  //   just that combination) so velocity/reorder math has something to divide by.

  router.get('/summary', authenticate, requirePermission('view_inventory_analysis'), async (req, res) => {
    try {
      const totals = await stockSummary(req.query);

      // Asset value is cost-basis data, gated separately from the page itself
      // (view_inventory_analysis) — strip it server-side rather than just
      // hiding it in the UI, since it's sitting right there in the response.
      const canViewPrices = req.user.permissions.includes('view_inventory_prices');

      const { byCategory, agingBuckets } = totals;
      res.json({
        totalItems: totals.totalItems,
        totalAssetValue: canViewPrices ? totals.totalAssetValue : null,
        totalAvailableQty: totals.totalAvailableQty,
        distinctProductCount: totals.distinctProductCount,
        byCategory: canViewPrices ? byCategory : byCategory.map(({ assetValue, ...rest }) => rest),
        agingBuckets: canViewPrices ? agingBuckets : agingBuckets.map(({ assetValue, ...rest }) => rest),
        lastImportedAt: totals.lastImportedAt,
        lastImportedByName: totals.lastImportedByName
      });
    } catch (error) {
      console.error('Inventory analysis summary error:', error);
      res.status(500).json({ message: 'Failed to load inventory summary' });
    }
  });

  router.get('/filters', authenticate, requirePermission('view_inventory_analysis'), async (req, res) => {
    try {
      const { categories, locations, statuses } = await stockFilterValues();
      res.json({
        categories: categories.filter(Boolean).sort(),
        locations: locations.filter(Boolean).sort(),
        statuses: statuses.filter(Boolean).sort()
      });
    } catch (error) {
      console.error('Inventory analysis filters error:', error);
      res.status(500).json({ message: 'Failed to load filters' });
    }
  });

  router.get('/items', authenticate, requirePermission('view_inventory_analysis'), async (req, res) => {
    try {
      const page = Math.max(1, parseInt(String(req.query.page || '')) || 1);
      const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || '')) || 25));
      const { items, total } = await listStockItems(req.query, page, limit);

      const canViewPrices = req.user.permissions.includes('view_inventory_prices');
      const sanitizedItems = canViewPrices
        ? items
        : items.map(({ assetValue, unitFobCost, unitLandedCost, purchaseCost, ...rest }) => rest);

      res.json({ items: sanitizedItems, total, page, totalPages: Math.ceil(total / limit) || 1 });
    } catch (error) {
      console.error('Inventory analysis items error:', error);
      res.status(500).json({ message: 'Failed to load inventory items' });
    }
  });

  // Stock Detail, grouped by product — one row per product with rolled-up
  // totals instead of one row per slab. Paginated by distinct product (not by
  // raw slab count), so a page of 25 always means 25 products regardless of
  // how many slabs each has. Expanding a group in the UI re-fetches that
  // product's individual slabs from GET /api/inventory-analysis/items?product=…
  // rather than shipping every slab of every product up front.
  router.get('/items/grouped', authenticate, requirePermission('view_inventory_analysis'), async (req, res) => {
    try {
      const page = Math.max(1, parseInt(String(req.query.page || '')) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '')) || 20));
      const { groups: found, total } = await stockGroups(req.query, page, limit);

      const canViewPrices = req.user.permissions.includes('view_inventory_prices');
      const groups = found.map(g => {
        // Keys must cover every bucket SLAB_STATUS_BUCKET can return, or that
        // bucket's ++ would land on undefined and ship NaN to the UI.
        const statusCounts: Record<string, number> = { available: 0, hold: 0, so: 0, pickticket: 0, packinglist: 0, transfer: 0, other: 0 };
        g.statuses.forEach((s: string) => { statusCounts[SLAB_STATUS_BUCKET(s)]++; });
        return {
          product: g._id,
          category: g.category,
          units: g.units,
          slabCount: g.slabCount,
          totalOnHand: g.totalOnHand,
          totalAvailable: g.totalAvailable,
          totalAssetValue: canViewPrices ? g.totalAssetValue : null,
          locations: g.locations.filter(Boolean).sort(),
          oldestReceivedDate: g.oldestReceivedDate,
          statusCounts
        };
      });

      res.json({ groups, total, page, totalPages: Math.ceil(total / limit) || 1 });
    } catch (error) {
      console.error('Inventory analysis grouped items error:', error);
      res.status(500).json({ message: 'Failed to load grouped inventory' });
    }
  });

  // Reorder / velocity view — joins on-hand quantity (InventoryItem) against
  // the most recent sold-quantity period per product+location
  // (InventorySalesRecord) to estimate days of supply left. Products with no
  // matching sales record (name didn't match, or no sales export imported yet)
  // are still returned with velocity/daysOfSupply as null rather than dropped,
  // since "we don't know" is a different, more honest state than "infinite".
  router.get('/velocity', authenticate, requirePermission('view_inventory_analysis'), async (req, res) => {
    try {
      const { onHand, latestPerKey } = await velocityInputs(req.query.location);
      const salesByKey = new Map(latestPerKey.map(s => [`${s._id.product}::${s._id.location}`, s]));
      const canViewPrices = req.user.permissions.includes('view_inventory_prices');

      const rows = onHand.map(item => {
        const key = `${item._id.product}::${item._id.location}`;
        const sale = salesByKey.get(key);
        let velocityPerDay = null;
        let daysOfSupply = null;
        if (sale) {
          const periodDays = Math.max(1, (new Date(sale.periodEnd).getTime() - new Date(sale.periodStart).getTime()) / (1000 * 60 * 60 * 24));
          velocityPerDay = sale.quantitySold / periodDays;
          daysOfSupply = velocityPerDay > 0 ? item.availableQuantity / velocityPerDay : null;
        }
        return {
          product: item._id.product,
          location: item._id.location,
          category: item.category,
          units: item.units,
          availableQuantity: item.availableQuantity,
          assetValue: canViewPrices ? item.assetValue : null,
          quantitySoldInPeriod: sale?.quantitySold ?? null,
          periodStart: sale?.periodStart ?? null,
          periodEnd: sale?.periodEnd ?? null,
          velocityPerDay,
          daysOfSupply
        };
      });

      rows.sort((a, b) => {
        if (a.daysOfSupply === null) return 1;
        if (b.daysOfSupply === null) return -1;
        return a.daysOfSupply - b.daysOfSupply;
      });

      res.json({ rows });
    } catch (error) {
      console.error('Inventory analysis velocity error:', error);
      res.status(500).json({ message: 'Failed to load velocity analysis' });
    }
  });

  // An import file parsed for its preview, kept briefly so the Import button
  // that follows doesn't upload and parse the same file a second time — an
  // In Stock export is ~12 MB, and sending it twice over an office connection
  // (then parsing it twice) was most of the wait. The preview answers with an
  // uploadId; apply passes it back instead of the file. One per person per kind,
  // for PARSED_UPLOAD_TTL; an expired or unknown id answers 410 and the browser
  // sends the file again (after a restart, say).
  const PARSED_UPLOAD_TTL = 10 * 60 * 1000;
  type ImportKind = Exclude<keyof WorkbookParseResults, 'customer'>;
  type ParsedImport<K extends ImportKind> = WorkbookParseResults[K] & { sourceFilename?: string; sourceHash?: string };
  const parsedUploads = new Map<string, { kind: ImportKind; userId: string; parsed: ParsedImport<ImportKind>; at: number }>();

  const rememberParsedUpload = <K extends ImportKind>(kind: K, userId: string, parsed: ParsedImport<K>) => {
    const now = Date.now();
    for (const [id, entry] of parsedUploads) {
      if (now - entry.at > PARSED_UPLOAD_TTL || (entry.kind === kind && entry.userId === userId)) parsedUploads.delete(id);
    }
    const id = randomUUID();
    parsedUploads.set(id, { kind, userId, parsed, at: now });
    return id;
  };

  const takeParsedUpload = <K extends ImportKind>(id: unknown, kind: K, userId: string): ParsedImport<K> | null => {
    const entry = id ? parsedUploads.get(String(id)) : null;
    if (!entry || entry.kind !== kind || entry.userId !== userId || Date.now() - entry.at > PARSED_UPLOAD_TTL) return null;
    parsedUploads.delete(String(id));
    // The kind checked above is the same key paired with this parser result on insertion.
    return entry.parsed as ParsedImport<K>;
  };

  /** The parsed import for an apply: the previewed one by uploadId, else the uploaded file. */
  const parsedImportFor = async <K extends ImportKind>(req: Request, kind: K): Promise<ParsedImport<K> | null> => {
    const kept = takeParsedUpload(req.body?.uploadId, kind, String(req.user?.id || ''));
    if (kept) return kept;
    if (!req.file) return null;
    return runWorkbookParse(kind, req.file.buffer);
  };

  router.get('/in-transit', authenticate, requirePermission('view_inventory_analysis'), async (req, res) => {
    try {
      const shipments = await listActiveShipments();
      res.json({ shipments });
    } catch (error) {
      console.error('In-transit inventory error:', error);
      res.status(500).json({ message: 'Failed to load in-transit containers' });
    }
  });

  router.post('/import/transit/preview', authenticate, requirePermission('import_inventory_analysis'), uploadMemory.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
      const parsed = { ...await runWorkbookParse('inventory-transit', req.file.buffer), sourceFilename: req.file.originalname, sourceHash: createHash('sha256').update(req.file.buffer).digest('hex') };
      const { headers, mapping, missingRequired, rows, errors, diagnostics, warnings } = parsed;
      const uploadId = missingRequired.length || errors.length ? null
        : rememberParsedUpload('inventory-transit', String(req.user?.id || ''), parsed);
      res.json({ headers, mapping, missingRequired, errors, diagnostics, warnings, totalRows: rows.length,
        branches: [...new Set(rows.map((r: { location: string }) => r.location))], shipmentCount: groupTransitShipments(rows).length, sample: rows.slice(0, 10), uploadId });
    } catch (error) {
      res.status(400).json({ message: `Preview failed: ${(error instanceof Error ? error.message : String(error))}` });
    }
  });

  router.post('/import/transit/apply', authenticate, requirePermission('import_inventory_analysis'), uploadMemory.single('file'), async (req, res) => {
    try {
      const parsed = await parsedImportFor(req, 'inventory-transit');
      if (!parsed) return res.status(req.body?.uploadId ? 410 : 400).json({ message: 'Select the in-transit file again' });
      if (parsed.missingRequired.length || parsed.errors.length) return res.status(400).json({ message: parsed.errors[0] || `Missing columns: ${parsed.missingRequired.join(', ')}` });
      const shipments = groupTransitShipments(parsed.rows);
      const complete = req.body.complete !== 'false' && req.body.complete !== false;
      let branches: string[];
      try { branches = req.body.branches ? (typeof req.body.branches === 'string' ? JSON.parse(req.body.branches) : req.body.branches) : [...new Set(parsed.rows.map((r: { location: string }) => r.location))]; }
      catch { return res.status(400).json({ message: 'Invalid report branch coverage' }); }
      if (!Array.isArray(branches) || branches.some(b => typeof b !== 'string')) return res.status(400).json({ message: 'Select report branches' });
      if (!parsed.rows.length && (!complete || !branches.length || ![true, 'true'].includes(req.body.confirmEmpty))) return res.status(400).json({ message: 'For an empty complete report, select its branches and confirm there are no in-transit containers' });
      const result = await publishTransitReport({ shipments, branches, complete,
        sourceFilename: req.file?.originalname || parsed.sourceFilename || '', sourceHash: req.file ? createHash('sha256').update(req.file.buffer).digest('hex') : parsed.sourceHash || '',
        importedByName: req.user?.displayName || req.user?.contactName || req.user?.username || '' });
      req.app.get('io')?.emit('inventory_analysis_update');
      res.json({ success: true, count: parsed.rows.length, ...result });
    } catch (error) {
      console.error('In-transit import error:', error);
      res.status(400).json({ message: `Import failed: ${(error instanceof Error ? error.message : String(error))}` });
    }
  });

  router.post('/import/stock/preview', authenticate, requirePermission('import_inventory_analysis'), uploadMemory.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
      // Parsed in a worker thread, not on this request's own thread — see
      // runWorkbookParse.ts for why an uploaded file needs that isolation.
      const parsed = { ...await runWorkbookParse('inventory-stock', req.file.buffer),
        sourceFilename: req.file.originalname, sourceHash: createHash('sha256').update(req.file.buffer).digest('hex') };
      const { headers, mapping, missingRequired, rows } = parsed;
      const uploadId = missingRequired.length ? null : rememberParsedUpload('inventory-stock', String(req.user?.id || ''), parsed);
      res.json({ success: true, headers, mapping, missingRequired, totalRows: rows.length, sample: rows.slice(0, 10), uploadId });
    } catch (error) {
      console.error('Inventory stock import preview error:', error);
      res.status(400).json({ message: `Preview failed: ${(error instanceof Error ? error.message : String(error))}` });
    }
  });

  router.post('/import/stock/apply', authenticate, requirePermission('import_inventory_analysis'), uploadMemory.single('file'), async (req, res) => {
    try {
      const parsed = await parsedImportFor(req, 'inventory-stock');
      if (!parsed) {
        return res.status(req.body?.uploadId ? 410 : 400).json({ message: req.body?.uploadId ? 'The previewed file has expired — send it again' : 'No file uploaded', code: 'upload-expired' });
      }
      const { missingRequired, rows } = parsed;
      if (missingRequired.length) {
        return res.status(400).json({ message: `Missing required column(s): ${missingRequired.join(', ')}` });
      }
      if (!rows.length) {
        return res.status(400).json({ message: 'No data rows found in file' });
      }

      const result = await importInventoryStock({
        rows,
        sourceFilename: req.file?.originalname || parsed.sourceFilename || '',
        sourceHash: req.file ? createHash('sha256').update(req.file.buffer).digest('hex') : parsed.sourceHash || '',
        importedByName: req.user?.displayName || req.user?.contactName || req.user?.username || '',
        importedById: req.user?.id ? String(req.user.id) : null,
      });

      req.app.get('io')?.emit('inventory_analysis_update');
      res.json({ success: true, ...result });
    } catch (error) {
      console.error('Inventory stock import apply error:', error);
      res.status(400).json({ message: `Import failed: ${(error instanceof Error ? error.message : String(error))}` });
    }
  });

  router.post('/import/sales/preview', authenticate, requirePermission('import_inventory_analysis'), uploadMemory.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
      const parsed = await runWorkbookParse('inventory-sales', req.file.buffer);
      const { headers, mapping, missingRequired, rows, detected } = parsed;
      const uploadId = missingRequired.length ? null : rememberParsedUpload('inventory-sales', String(req.user?.id || ''), parsed);
      res.json({ success: true, headers, mapping, missingRequired, totalRows: rows.length, sample: rows.slice(0, 10), detected, uploadId });
    } catch (error) {
      console.error('Inventory sales import preview error:', error);
      res.status(400).json({ message: `Preview failed: ${(error instanceof Error ? error.message : String(error))}` });
    }
  });

  router.post('/import/sales/apply', authenticate, requirePermission('import_inventory_analysis'), uploadMemory.single('file'), async (req, res) => {
    try {
      const parsed = await parsedImportFor(req, 'inventory-sales');
      if (!parsed) {
        return res.status(req.body?.uploadId ? 410 : 400).json({ message: req.body?.uploadId ? 'The previewed file has expired — send it again' : 'No file uploaded', code: 'upload-expired' });
      }
      const { missingRequired, rows } = parsed;
      if (missingRequired.length) {
        return res.status(400).json({ message: `Missing required column(s): ${missingRequired.join(', ')}` });
      }
      if (!rows.length) {
        return res.status(400).json({ message: 'No data rows found in file' });
      }

      const location = String(req.body.location || '').trim();
      const periodStart = req.body.periodStart ? new Date(req.body.periodStart) : null;
      const periodEnd = req.body.periodEnd ? new Date(req.body.periodEnd) : null;
      if (!location) return res.status(400).json({ message: 'Location is required' });
      if (!periodStart || !periodEnd || !validDay(String(req.body.periodStart)) || !validDay(String(req.body.periodEnd))) {
        return res.status(400).json({ message: 'A valid period start and end date are required' });
      }
      // A reversed range doesn't fail loudly downstream — the velocity endpoint
      // floors (periodEnd - periodStart) at 1 day, so a swapped start/end would
      // silently read the whole period's total as "sold in one day" and make
      // every product's days-of-supply look ~N times too low.
      if (periodStart > periodEnd) {
        return res.status(400).json({ message: 'Period start must be before period end' });
      }

      const importedAt = new Date();
      const importedByName = req.user?.displayName || req.user?.contactName || req.user?.username || '';
      const importedById = req.user?.id || null;

      if (areaOn('inventory') !== 'postgres') await PurchasingScope.createCollection();
      await replaceSalesPeriod({ location, periodStart, periodEnd, rows, importedAt, importedByName, importedById },
        async (previous, { session, tx }) => {
          const oldAt = previous.map(r => r.importedAt?.toISOString()).filter(Boolean).sort().at(-1) || '';
          const identity = reportIdentity(location, periodStart.toISOString().slice(0, 10), periodEnd.toISOString().slice(0, 10), oldAt, previous as unknown as Parameters<typeof reportIdentity>[4]);
          // Backfill legacy references before replacing their source row IDs.
          // On Postgres this runs inside the replacement's own transaction (`tx`), so it is atomic with it.
          if (tx) await rekeyScopeCohorts(tx as Parameters<typeof rekeyScopeCohorts>[0], identity.legacyId, identity.id);
          else await PurchasingScope.updateMany({ cohortId: identity.legacyId }, { $set: { cohortId: identity.id }, $inc: { __v: 1 } }, session ? { session } : {});
        });

      req.app.get('io')?.emit('inventory_analysis_update');
      res.json({ success: true, count: rows.length, location, periodStart, periodEnd });
    } catch (error) {
      console.error('Inventory sales import apply error:', error);
      res.status(400).json({ message: `Import failed: ${(error instanceof Error ? error.message : String(error))}` });
    }
  });

  return router;
}
