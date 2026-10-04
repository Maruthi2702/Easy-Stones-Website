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
import { randomUUID } from 'crypto';
import InventoryItem from '../models/InventoryItem.js';
import InventorySalesRecord from '../models/InventorySalesRecord.js';
import { SLAB_STATUS_BUCKET } from '../utils/inventoryStatus.js';
// Parses run in a worker thread — see runWorkbookParse.js for why an uploaded
// file needs that isolation.
import { runWorkbookParse } from '../utils/runWorkbookParse.js';

/**
 * @param {object} deps
 * @param {Function} deps.authenticate - server.js's auth middleware
 * @param {Function} deps.requirePermission - server.js's permission middleware
 * @param {object} deps.uploadMemory - server.js's in-memory multer instance
 */
export default function createInventoryAnalysisRouter({ authenticate, requirePermission, uploadMemory }) {
  const router = express.Router();

  // Two SPS exports feed this feature (see src/utils/inventoryImport.js):
  // - "stock": a full mirror of on-hand slabs/lots, wiped and replaced whole on
  //   every import since it's a point-in-time snapshot, not a ledger.
  // - "sales": per-product sold totals for a location+date-range period, kept
  //   alongside prior periods (re-importing the same period+location replaces
  //   just that combination) so velocity/reorder math has something to divide by.

  // ?location= on the inventory routes: one branch, or several comma-separated
  // (Inventory's location filter lets people pick more than one). Empty means
  // every branch; undefined is returned so callers can skip the clause.
  const inventoryLocationMatch = (location) => {
    const list = String(location || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!list.length) return undefined;
    return list.length === 1 ? list[0] : { $in: list };
  };

  // Shared by /summary and /items so the two never drift apart on what a
  // given search/category/location/status combination actually matches.
  const buildInventoryItemQuery = ({ search = '', category = '', location = '', status = '', product = '' } = {}) => {
    const query = {};
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
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 25));
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
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
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
      const groups = (result?.data || []).map(g => {
        // Keys must cover every bucket SLAB_STATUS_BUCKET can return, or that
        // bucket's ++ would land on undefined and ship NaN to the UI.
        const statusCounts = { available: 0, hold: 0, so: 0, pickticket: 0, packinglist: 0, transfer: 0, other: 0 };
        g.statuses.forEach(s => { statusCounts[SLAB_STATUS_BUCKET(s)]++; });
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
          const periodDays = Math.max(1, (new Date(sale.periodEnd) - new Date(sale.periodStart)) / (1000 * 60 * 60 * 24));
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

  const rememberParsedUpload = (kind, userId, parsed) => {
    const now = Date.now();
    for (const [id, entry] of parsedUploads) {
      if (now - entry.at > PARSED_UPLOAD_TTL || (entry.kind === kind && entry.userId === userId)) parsedUploads.delete(id);
    }
    const id = randomUUID();
    parsedUploads.set(id, { kind, userId, parsed, at: now });
    return id;
  };

  const takeParsedUpload = (id, kind, userId) => {
    const entry = id ? parsedUploads.get(String(id)) : null;
    if (!entry || entry.kind !== kind || entry.userId !== userId || Date.now() - entry.at > PARSED_UPLOAD_TTL) return null;
    parsedUploads.delete(String(id));
    return entry.parsed;
  };

  /** The parsed import for an apply: the previewed one by uploadId, else the uploaded file. */
  const parsedImportFor = async (req, kind) => {
    const kept = takeParsedUpload(req.body?.uploadId, kind, String(req.user?.id || ''));
    if (kept) return kept;
    if (!req.file) return null;
    return runWorkbookParse(kind, req.file.buffer);
  };

  router.post('/import/stock/preview', authenticate, requirePermission('import_inventory_analysis'), uploadMemory.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
      // Parsed in a worker thread, not on this request's own thread — see
      // runWorkbookParse.js for why an uploaded file needs that isolation.
      const parsed = await runWorkbookParse('inventory-stock', req.file.buffer);
      const { headers, mapping, missingRequired, rows } = parsed;
      const uploadId = missingRequired.length ? null : rememberParsedUpload('inventory-stock', String(req.user?.id || ''), parsed);
      res.json({ success: true, headers, mapping, missingRequired, totalRows: rows.length, sample: rows.slice(0, 10), uploadId });
    } catch (error) {
      console.error('Inventory stock import preview error:', error);
      res.status(400).json({ message: `Preview failed: ${error.message}` });
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

      const importedAt = new Date();
      const importedByName = req.user?.displayName || req.user?.contactName || req.user?.username || '';
      const importedById = req.user?.id ? String(req.user.id) : null;
      // Written lean — straight to the collection, without building a Mongoose
      // document per row. The parser already gives every field its final type
      // (strings trimmed, numbers and dates converted, rows without a product
      // dropped), so the per-row casting and validation only cost time on the
      // ~11k-row file. Lean also skips the automatic timestamps and version key,
      // set here so the rows match what a normal insert writes.
      const docs = rows.map(r => ({ ...r, importedAt, importedByName, importedById, createdAt: importedAt, updatedAt: importedAt, __v: 0 }));

      // Insert the new snapshot BEFORE removing the old one. This used to
      // delete everything first — if insertMany then threw partway through
      // (a bad row, a dropped connection), the whole InventoryItems collection
      // was left empty with no way back, the same class of data-loss incident
      // as the Daily Work Report bug documented in CLAUDE.md. `importedAt` is
      // identical for every row in this batch, so it doubles as a batch tag:
      // on failure, only this batch's (possibly partial) rows are removed and
      // the previous snapshot is untouched.
      try {
        await InventoryItem.insertMany(docs, { ordered: false, lean: true });
      } catch (insertErr) {
        await InventoryItem.deleteMany({ importedAt }).catch(() => {});
        throw insertErr;
      }
      await InventoryItem.deleteMany({ importedAt: { $ne: importedAt } });

      req.app.get('io')?.emit('inventory_analysis_update');
      res.json({ success: true, count: docs.length, importedAt });
    } catch (error) {
      console.error('Inventory stock import apply error:', error);
      res.status(400).json({ message: `Import failed: ${error.message}` });
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
      res.status(400).json({ message: `Preview failed: ${error.message}` });
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
      const previousDocs = await InventorySalesRecord.find({ location, periodStart, periodEnd }).lean();
      await InventorySalesRecord.deleteMany({ location, periodStart, periodEnd });
      try {
        await InventorySalesRecord.insertMany(
          rows.map(r => ({ ...r, location, periodStart, periodEnd, importedAt, importedByName, importedById })),
          { ordered: false }
        );
      } catch (insertErr) {
        await InventorySalesRecord.deleteMany({ location, periodStart, periodEnd }).catch(() => {});
        if (previousDocs.length) {
          const restoreDocs = previousDocs.map(({ _id, __v, ...rest }) => rest);
          await InventorySalesRecord.insertMany(restoreDocs, { ordered: false }).catch(() => {});
        }
        throw insertErr;
      }

      req.app.get('io')?.emit('inventory_analysis_update');
      res.json({ success: true, count: rows.length, location, periodStart, periodEnd });
    } catch (error) {
      console.error('Inventory sales import apply error:', error);
      res.status(400).json({ message: `Import failed: ${error.message}` });
    }
  });

  return router;
}
