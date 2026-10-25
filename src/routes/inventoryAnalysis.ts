/**
 * Inventory Analysis — stock levels, aging, and reorder signals from SPS's
 * exports. Moved out of server.js: a self-contained feature with its own
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
import type { Model, QueryFilter } from 'mongoose';

// Authentication is supplied by server.js before any handler runs.
declare module 'express-serve-static-core' {
  interface Request {
    user: { id?: string; username?: string; displayName?: string; contactName?: string; permissions: string[] };
  }
}
import mongoose from 'mongoose';
import { randomUUID, createHash } from 'crypto';
import { importInventoryStock } from '../services/inventoryStockImport.ts';
import InventoryItem from '../models/InventoryItem.ts';
import InventorySalesRecordModel from '../models/InventorySalesRecord.js';
const InventorySalesRecord = InventorySalesRecordModel as Model<Record<string, any>>;
import InventoryTransitShipment from '../models/InventoryTransitShipment.ts';
import { groupTransitShipments } from '../utils/inventoryTransitImport.ts';
import { SLAB_STATUS_BUCKET } from '../utils/inventoryStatus.js';
// Parses run in a worker thread — see runWorkbookParse.ts for why an uploaded
// file needs that isolation.
import { runWorkbookParse } from '../utils/runWorkbookParse.ts';
// Big writes go in batches that survive a dropped database connection.
import { insertInBatches, withDbRetry } from '../utils/dbRetry.js';

/**
 * @param {object} deps
 * @param {Function} deps.authenticate - server.js's auth middleware
 * @param {Function} deps.requirePermission - server.js's permission middleware
 * @param {object} deps.uploadMemory - server.js's in-memory multer instance
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

  // ?location= on the inventory routes: one branch, or several comma-separated
  // (Inventory's location filter lets people pick more than one). Empty means
  // every branch; undefined is returned so callers can skip the clause.
  const inventoryLocationMatch = (location: unknown) => {
    const list = String(location || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!list.length) return undefined;
    return list.length === 1 ? list[0] : { $in: list };
  };

  // Shared by /summary and /items so the two never drift apart on what a
  // given search/category/location/status combination actually matches.
  const buildInventoryItemQuery = ({ search = '', category = '', location = '', status = '', product = '' } = {}) => {
    const query: QueryFilter<Record<string, any>> = {};
    if (product) query.product = product;
    if (category) query.category = category;
    const locationMatch = inventoryLocationMatch(location);
    if (locationMatch) query.location = locationMatch;
    if (status === 'available') query.slabStatus = '';
    else if (status) query.slabStatus = status;
    if (search) {
      const re = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ product: re }, { sku: re }, { supplier: re }, { block: re }, { serialNumber: re }];
    }
    return query;
  };

  router.get('/summary', authenticate, requirePermission('view_inventory_analysis'), async (req, res) => {
    try {
      const filterQuery = buildInventoryItemQuery(req.query);
      const now = new Date();

      // Independent reads against the same collection — run them concurrently
      // instead of five serialized round trips (this fires on every filter
      // change, debounced but still per-keystroke-adjacent).
      const [[totals], byCategory, agingBuckets, distinctProducts, latest] = await Promise.all([
        InventoryItem.aggregate([
          { $match: filterQuery },
          { $group: {
              _id: null,
              totalItems: { $sum: 1 },
              totalAssetValue: { $sum: '$assetValue' },
              totalAvailableQty: { $sum: '$availableQuantity' }
          } }
        ]),
        InventoryItem.aggregate([
          { $match: filterQuery },
          { $group: {
              _id: '$category',
              items: { $sum: 1 },
              assetValue: { $sum: '$assetValue' },
              availableQty: { $sum: '$availableQuantity' }
          } },
          { $sort: { assetValue: -1 } },
          { $project: { _id: 0, category: { $ifNull: ['$_id', 'Uncategorized'] }, items: 1, assetValue: 1, availableQty: 1 } }
        ]),
        InventoryItem.aggregate([
          { $match: { ...filterQuery, receivedDate: { $ne: null } } },
          { $project: {
              assetValue: 1,
              ageDays: { $divide: [{ $subtract: [now, '$receivedDate'] }, 1000 * 60 * 60 * 24] }
          } },
          { $bucket: {
              groupBy: '$ageDays',
              boundaries: [0, 30, 60, 90, 180, 365, Infinity],
              default: 'unknown',
              output: { count: { $sum: 1 }, assetValue: { $sum: '$assetValue' } }
          } }
        ]),
        InventoryItem.distinct('product', filterQuery),
        // "Last synced" always reflects the most recent import overall, not the
        // filtered subset — a filter narrowing to zero rows shouldn't make the
        // sync timestamp disappear.
        InventoryItem.findOne().sort({ importedAt: -1 }).select('importedAt importedByName').lean()
      ]);

      // Asset value is cost-basis data, gated separately from the page itself
      // (view_inventory_analysis) — strip it server-side rather than just
      // hiding it in the UI, since it's sitting right there in the response.
      const canViewPrices = req.user.permissions.includes('view_inventory_prices');

      res.json({
        totalItems: totals?.totalItems || 0,
        totalAssetValue: canViewPrices ? (totals?.totalAssetValue || 0) : null,
        totalAvailableQty: totals?.totalAvailableQty || 0,
        distinctProductCount: distinctProducts.length,
        byCategory: canViewPrices ? byCategory : byCategory.map(({ assetValue, ...rest }) => rest),
        agingBuckets: canViewPrices ? agingBuckets : agingBuckets.map(({ assetValue, ...rest }) => rest),
        lastImportedAt: latest?.importedAt || null,
        lastImportedByName: latest?.importedByName || ''
      });
    } catch (error) {
      console.error('Inventory analysis summary error:', error);
      res.status(500).json({ message: 'Failed to load inventory summary' });
    }
  });

  router.get('/filters', authenticate, requirePermission('view_inventory_analysis'), async (req, res) => {
    try {
      const [categories, locations, statuses] = await Promise.all([
        InventoryItem.distinct('category'),
        InventoryItem.distinct('location'),
        InventoryItem.distinct('slabStatus')
      ]);
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
      const query = buildInventoryItemQuery(req.query);

      const [items, total] = await Promise.all([
        InventoryItem.find(query).sort({ receivedDate: 1 }).skip((page - 1) * limit).limit(limit).lean(),
        InventoryItem.countDocuments(query)
      ]);

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
      const filterQuery = buildInventoryItemQuery(req.query);

      const [result] = await InventoryItem.aggregate([
        { $match: filterQuery },
        { $group: {
            _id: '$product',
            category: { $first: '$category' },
            units: { $first: '$units' },
            slabCount: { $sum: 1 },
            totalOnHand: { $sum: '$instockQty' },
            totalAvailable: { $sum: '$availableQuantity' },
            totalAssetValue: { $sum: '$assetValue' },
            locations: { $addToSet: '$location' },
            oldestReceivedDate: { $min: '$receivedDate' },
            statuses: { $push: '$slabStatus' }
        } },
        // Product name breaks ties: products received the same day used to
        // come back in a different order on every request, so paging could
        // show one twice and skip another.
        { $sort: { oldestReceivedDate: 1, _id: 1 } },
        { $facet: {
            data: [{ $skip: (page - 1) * limit }, { $limit: limit }],
            totalCount: [{ $count: 'count' }]
        } }
      ]);

      const canViewPrices = req.user.permissions.includes('view_inventory_prices');
      const groups = (result?.data || []).map((g: Record<string, any>) => {
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

      const total = result?.totalCount?.[0]?.count || 0;
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
      const locationMatch = inventoryLocationMatch(req.query.location);

      const stockMatch = locationMatch ? { location: locationMatch } : {};
      const onHand = await InventoryItem.aggregate([
        { $match: stockMatch },
        { $group: {
            _id: { product: '$product', location: '$location' },
            availableQuantity: { $sum: '$availableQuantity' },
            assetValue: { $sum: '$assetValue' },
            units: { $first: '$units' },
            category: { $first: '$category' }
        } }
      ]);

      const salesMatch = locationMatch ? { location: locationMatch } : {};
      const latestPerKey = await InventorySalesRecord.aggregate([
        { $match: salesMatch },
        { $sort: { periodEnd: -1 } },
        { $group: {
            _id: { product: '$product', location: '$location' },
            quantitySold: { $first: '$quantitySold' },
            periodStart: { $first: '$periodStart' },
            periodEnd: { $first: '$periodEnd' }
        } }
      ]);
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
  const parsedUploads = new Map(); // id → { kind, userId, parsed, at }

  const rememberParsedUpload = (kind: string, userId: string, parsed: any) => {
    const now = Date.now();
    for (const [id, entry] of parsedUploads) {
      if (now - entry.at > PARSED_UPLOAD_TTL || (entry.kind === kind && entry.userId === userId)) parsedUploads.delete(id);
    }
    const id = randomUUID();
    parsedUploads.set(id, { kind, userId, parsed, at: now });
    return id;
  };

  const takeParsedUpload = (id: unknown, kind: string, userId: string) => {
    const entry = id ? parsedUploads.get(String(id)) : null;
    if (!entry || entry.kind !== kind || entry.userId !== userId || Date.now() - entry.at > PARSED_UPLOAD_TTL) return null;
    parsedUploads.delete(String(id));
    return entry.parsed;
  };

  /** The parsed import for an apply: the previewed one by uploadId, else the uploaded file. */
  const parsedImportFor = async (req: Request, kind: Parameters<typeof runWorkbookParse>[0]) => {
    const kept = takeParsedUpload(req.body?.uploadId, kind, String(req.user?.id || ''));
    if (kept) return kept;
    if (!req.file) return null;
    return runWorkbookParse(kind, req.file.buffer);
  };

  router.get('/in-transit', authenticate, requirePermission('view_inventory_analysis'), async (req, res) => {
    try {
      const shipments = await InventoryTransitShipment.find().sort({ poNumber: 1, containerNumber: 1 }).lean();
      res.json({ shipments });
    } catch (error) {
      console.error('In-transit inventory error:', error);
      res.status(500).json({ message: 'Failed to load in-transit containers' });
    }
  });

  router.post('/import/transit/preview', authenticate, requirePermission('import_inventory_analysis'), uploadMemory.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
      const parsed = await runWorkbookParse('inventory-transit', req.file.buffer);
      const { headers, mapping, missingRequired, rows, errors, diagnostics, warnings } = parsed;
      const uploadId = missingRequired.length || errors.length || !rows.length ? null
        : rememberParsedUpload('inventory-transit', String(req.user?.id || ''), parsed);
      res.json({ headers, mapping, missingRequired, errors, diagnostics, warnings, totalRows: rows.length,
        shipmentCount: groupTransitShipments(rows).length, sample: rows.slice(0, 10), uploadId });
    } catch (error) {
      res.status(400).json({ message: `Preview failed: ${(error instanceof Error ? error.message : String(error))}` });
    }
  });

  router.post('/import/transit/apply', authenticate, requirePermission('import_inventory_analysis'), uploadMemory.single('file'), async (req, res) => {
    try {
      const parsed = await parsedImportFor(req, 'inventory-transit');
      if (!parsed) return res.status(req.body?.uploadId ? 410 : 400).json({ message: 'Select the in-transit file again' });
      if (parsed.missingRequired.length || parsed.errors.length || !parsed.rows.length) {
        return res.status(400).json({ message: parsed.errors[0] ||
          (parsed.missingRequired.length ? `Missing columns: ${parsed.missingRequired.join(', ')}` : 'No INTRANSIT product rows found') });
      }
      const shipments = groupTransitShipments(parsed.rows);
      const importedAt = new Date();
      const importedByName = req.user?.displayName || req.user?.contactName || req.user?.username || '';
      await withDbRetry(() => InventoryTransitShipment.bulkWrite(shipments.map(shipment => ({
        updateOne: {
          filter: { poNumber: shipment.poNumber, containerNumber: shipment.containerNumber, location: shipment.location },
          update: { $set: { ...shipment, importedAt, importedByName } }, upsert: true
        }
      }))));
      req.app.get('io')?.emit('inventory_analysis_update');
      res.json({ success: true, count: parsed.rows.length, shipmentCount: shipments.length, importedAt });
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
      if (!periodStart || !periodEnd || Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
        return res.status(400).json({ message: 'A valid period start and end date are required' });
      }
      // A reversed range doesn't fail loudly downstream — the velocity endpoint
      // floors (periodEnd - periodStart) at 1 day, so a swapped start/end would
      // silently read the whole period's total as "sold in one day" and make
      // every product's days-of-supply look ~N times too low.
      if (periodStart >= periodEnd) {
        return res.status(400).json({ message: 'Period start must be before period end' });
      }

      const importedAt = new Date();
      const importedByName = req.user?.displayName || req.user?.contactName || req.user?.username || '';
      const importedById = req.user?.id || null;

      // Re-importing the same period+location is a correction, not a
      // duplicate — replace just that slice rather than every period on file.
      // The unique (product, location, periodStart, periodEnd) index means the
      // new rows can't be inserted ahead of the old ones the way the stock
      // import does it, so this keeps an in-memory backup of the slice being
      // replaced and restores it if insertMany throws partway — a failed
      // re-import falls back to the last-known-good data instead of leaving
      // that period+location empty.
      // Each step resent on a dropped connection (src/utils/dbRetry.js); rows
      // carry their _id from here so a resent batch can't write one twice.
      const previousDocs = await withDbRetry(() => InventorySalesRecord.find({ location, periodStart, periodEnd }).lean());
      await withDbRetry(() => InventorySalesRecord.deleteMany({ location, periodStart, periodEnd }));
      try {
        const refused = await insertInBatches(
          InventorySalesRecord,
          rows.map((r: Record<string, any>) => ({ _id: new mongoose.Types.ObjectId(), ...r, location, periodStart, periodEnd, importedAt, importedByName, importedById }))
        );
        if (refused.size) {
          const [index, message] = refused.entries().next().value!;
          throw new Error(`Row ${index + 1} could not be saved: ${message}`);
        }
      } catch (insertErr) {
        await withDbRetry(() => InventorySalesRecord.deleteMany({ location, periodStart, periodEnd })).catch(() => {});
        if (previousDocs.length) {
          const restoreDocs = previousDocs.map(({ _id, __v, ...rest }: Record<string, any>) => rest);
          await withDbRetry(() => InventorySalesRecord.insertMany(restoreDocs, { ordered: false })).catch(() => {});
        }
        throw insertErr;
      }

      req.app.get('io')?.emit('inventory_analysis_update');
      res.json({ success: true, count: rows.length, location, periodStart, periodEnd });
    } catch (error) {
      console.error('Inventory sales import apply error:', error);
      res.status(400).json({ message: `Import failed: ${(error instanceof Error ? error.message : String(error))}` });
    }
  });

  return router;
}
