/** MongoDB → Postgres rows for the remaining collections (src/db/schema/misc.ts). */
import type { Loose } from '../../types/records.ts';
import type {
  lostSales, products, productColors, productBundles, easyStonesColors, crossoverColors, crossovers, appSettings,
  importMemories, contactSubmissions, teamFiles, salesResources, spsImportRuns, spsImportItems, cloudinaryToS3Backups,
  legacyLeads, legacySalesCustomers
} from '../schema/misc.ts';
import type { ReferenceIndex } from './referenceRows.ts';
import type { CustomerIndex } from './customerRows.ts';
import { stamp } from './referenceRows.ts';
import { plainJson, snapshotJson } from './linkedRows.ts';
import {
  idOf, idTime, textOf, rowConverter, intOf, pickOf, decimalOf, stringsOf, boolOf, locationIdOf, linkOf, type CopyProblem
} from './values.ts';

type Row<T extends { $inferInsert: unknown }> = T['$inferInsert'];

export interface MiscSource {
  lostSales: Loose[];
  products: Loose[];
  easyStonesColors: Loose[];
  crossoverColors: Loose[];
  appSettings: Loose[];
  importMemories: Loose[];
  contactSubmissions: Loose[];
  teamFiles: Loose[];
  salesResources: Loose[];
  spsImportRuns: Loose[];
  spsImportItems: Loose[];
  cloudinaryToS3Backups: Loose[];
  legacyLeads: Loose[];
  legacySalesCustomers: Loose[];
}

export interface MiscRows {
  lostSales: Row<typeof lostSales>[];
  products: Row<typeof products>[];
  productColors: Row<typeof productColors>[];
  productBundles: Row<typeof productBundles>[];
  easyStonesColors: Row<typeof easyStonesColors>[];
  crossoverColors: Row<typeof crossoverColors>[];
  crossovers: Row<typeof crossovers>[];
  appSettings: Row<typeof appSettings>[];
  importMemories: Row<typeof importMemories>[];
  contactSubmissions: Row<typeof contactSubmissions>[];
  teamFiles: Row<typeof teamFiles>[];
  salesResources: Row<typeof salesResources>[];
  spsImportRuns: Row<typeof spsImportRuns>[];
  spsImportItems: Row<typeof spsImportItems>[];
  cloudinaryToS3Backups: Row<typeof cloudinaryToS3Backups>[];
  legacyLeads: Row<typeof legacyLeads>[];
  legacySalesCustomers: Row<typeof legacySalesCustomers>[];
}

const obj = (v: unknown): Loose => (v && typeof v === 'object' ? v : {}) as Loose;
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const optText = (v: unknown): string | null => v == null ? null : String(v);
const json = (v: unknown, fallback: unknown) => plainJson(v ?? fallback);
const optJson = (v: unknown) => (v === undefined ? null : plainJson(v));
const bytesOf = (v: unknown): Buffer | null => {
  if (Buffer.isBuffer(v)) return v;
  if (v instanceof Uint8Array) return Buffer.from(v);
  const inner = (v as { buffer?: unknown })?.buffer;
  return inner instanceof Uint8Array ? Buffer.from(inner) : null;
};

/**
 * A createdAt saved as text with no zone ('2026-…T…'): the server (UTC on Render)
 * reads it as UTC when Mongoose casts it, so the copy does the same.
 */
function createdMoment(c: ReturnType<typeof rowConverter>, d: Loose): Date {
  const v = d.createdAt;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(v)) {
    const at = new Date(`${v}Z`);
    if (!Number.isNaN(at.getTime())) { c.problem('created_at', 'time with no zone read as UTC, as the server reads it', 'converted'); return at; }
  }
  return c.moment('created_at', v) ?? idTime(d._id);
}

export function miscRows(src: MiscSource, ref: ReferenceIndex, cust: CustomerIndex, problems: CopyProblem[]): MiscRows {
  const rows: MiscRows = {
    lostSales: [], products: [], productColors: [], productBundles: [], easyStonesColors: [], crossoverColors: [], crossovers: [],
    appSettings: [], importMemories: [], contactSubmissions: [], teamFiles: [], salesResources: [], spsImportRuns: [],
    spsImportItems: [], cloudinaryToS3Backups: [], legacyLeads: [], legacySalesCustomers: []
  };

  for (const d of src.lostSales) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'lost_sales', id);
    rows.lostSales.push({
      id, customerName: textOf(d.customerName), customerId: linkOf(c, 'customer_id', d.customerId, cust.customerIds, 'customer'),
      productName: textOf(d.productName), productId: optText(d.productId),
      lengthInches: decimalOf(d.lengthInches), widthInches: decimalOf(d.widthInches), sfPerSlab: decimalOf(d.sfPerSlab),
      slabsCount: decimalOf(d.slabsCount), totalSf: decimalOf(d.totalSf), pricePerSf: decimalOf(d.pricePerSf),
      totalLostValue: decimalOf(d.totalLostValue), reason: textOf(d.reason),
      locationId: locationIdOf(c, 'location_id', d.location, ref.locationIdByName), competitorName: textOf(d.competitorName),
      notes: textOf(d.notes), salesRepName: textOf(d.salesRepName),
      salesRepId: linkOf(c, 'sales_rep_id', d.salesRepId, ref.userIds, 'user'),
      lostAt: c.moment('lost_at', d.date) ?? idTime(d._id), ...stamp(c, d)
    });
  }

  for (const d of src.products) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'products', id);
    const number = intOf(c, 'product_number', d.id);
    if (number == null) { c.problem('product_number', 'no product number', 'skipped'); continue; }
    const levels = obj(d.priceLevels);
    rows.products.push({
      id, productNumber: number, name: textOf(d.name), category: textOf(d.category), collectionType: optText(d.collectionType),
      availability: textOf(d.availability) || 'In Stock', image: optText(d.image), installedImages: stringsOf(d.installedImages),
      isNewArrival: boolOf(d.isNewArrival), showInSlider: boolOf(d.showInSlider), thickness: stringsOf(d.thickness),
      sizes: stringsOf(d.sizes), description: optText(d.description), primaryColor: optText(d.primaryColor),
      accentColor: optText(d.accentColor), style: optText(d.style), variations: textOf(d.variations) || 'Low',
      finishes: stringsOf(d.finishes), applications: stringsOf(d.applications),
      bookMatch: pickOf(c, 'book_match', d.bookMatch, ['N/A', 'Yes', 'No'] as const, 'N/A'), landingCost: decimalOf(d.landingCost),
      priceLevel1: decimalOf(levels.level1), priceLevel2: decimalOf(levels.level2), priceLevel3: decimalOf(levels.level3),
      priceLevel4: decimalOf(levels.level4), price: optText(d.price), ...stamp(c, d)
    });
    list(d.colors).forEach((x, position) => {
      rows.productColors.push({ productId: id, position, name: textOf(obj(x).name), image: optText(obj(x).image) });
    });
    list(d.bundles).forEach((x, position) => {
      const b = obj(x), bid = idOf(b._id);
      if (!bid) { c.problem('bundles.id', 'bundle with no id', 'skipped'); return; }
      rows.productBundles.push({
        id: bid, productId: id, position, bundleNumber: optText(b.bundleNumber), serial: optText(b.serial),
        avgSize: optText(b.avgSize), qty: optText(b.qty), location: optText(b.location), images: stringsOf(b.images)
      });
    });
  }

  for (const d of src.easyStonesColors) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'easy_stones_colors', id);
    rows.easyStonesColors.push({ id, name: textOf(d.name), order: intOf(c, 'order', d.order) ?? 0, ...stamp(c, d) });
  }

  for (const d of src.crossoverColors) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'crossover_colors', id);
    rows.crossoverColors.push({ id, easyStonesName: textOf(d.easyStonesName), ...stamp(c, d) });
    list(d.crossovers).forEach((x, position) => {
      const e = obj(x), eid = idOf(e._id);
      if (!eid) { c.problem('crossovers.id', 'crossover with no id', 'skipped'); return; }
      const ec = rowConverter(problems, 'crossovers', eid);
      rows.crossovers.push({
        id: eid, colorId: id, position, distributorName: textOf(e.distributorName), distributorColorName: textOf(e.distributorColorName),
        matchType: pickOf(ec, 'match_type', e.matchType, ['Direct Crossover', 'Similar'] as const, 'Similar'),
        notes: textOf(e.notes), addedByName: textOf(e.addedByName), addedById: textOf(e.addedById), ...stamp(ec, e)
      });
    });
  }

  for (const d of src.appSettings) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'app_settings', id);
    rows.appSettings.push({ id, key: textOf(d.key), value: optJson(d.value), updatedBy: textOf(d.updatedBy), ...stamp(c, d) });
  }

  for (const d of src.importMemories) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'import_memories', id);
    rows.importMemories.push({
      id, kind: textOf(d.kind), repAliases: json(d.repAliases, {}), branchAliases: json(d.branchAliases, {}),
      decisions: json(d.decisions, {}), updatedBy: textOf(d.updatedBy), ...stamp(c, d)
    });
  }

  for (const d of src.contactSubmissions) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'contact_submissions', id);
    rows.contactSubmissions.push({
      id, name: textOf(d.name), company: optText(d.company), email: textOf(d.email), phone: optText(d.phone),
      message: textOf(d.message), status: pickOf(c, 'status', d.status, ['new', 'read', 'replied'] as const, 'new'),
      emailSent: boolOf(d.emailSent), ...stamp(c, d)
    });
  }

  for (const d of src.teamFiles) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'team_files', id);
    rows.teamFiles.push({
      id, name: textOf(d.name), type: textOf(d.type), content: textOf(d.content), thumbnail: textOf(d.thumbnail),
      contentType: textOf(d.contentType), isFolder: boolOf(d.isFolder), parentId: idOf(d.parentId), uploadedBy: idOf(d.uploadedBy),
      size: intOf(c, 'size', d.size), pinned: boolOf(d.pinned), pinnedAt: optText(d.pinnedAt), pinnedBy: idOf(d.pinnedBy),
      updatedBy: idOf(d.updatedBy), updatedAt: optText(d.updatedAt),
      createdAt: createdMoment(c, d)
    });
  }

  for (const d of src.salesResources) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'sales_resources', id);
    rows.salesResources.push({
      id, name: textOf(d.name), type: textOf(d.type), content: textOf(d.content), contentType: textOf(d.contentType),
      uploadedBy: idOf(d.uploadedBy), createdAt: c.moment('created_at', d.createdAt) ?? idTime(d._id)
    });
  }

  const runIds = new Set<string>();
  for (const d of src.spsImportRuns) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'sps_import_runs', id);
    runIds.add(id);
    rows.spsImportRuns.push({
      id, fileName: textOf(d.fileName), fingerprint: textOf(d.fingerprint), file: bytesOf(d.file),
      createdBy: textOf(d.createdBy), createdById: textOf(d.createdById), status: textOf(d.status) || 'draft',
      mapping: json(d.mapping, {}), repAliases: json(d.repAliases, {}), branchAliases: json(d.branchAliases, {}),
      answers: json(d.answers, {}), fileCheck: optJson(d.fileCheck), rowsRead: intOf(c, 'rows_read', d.rowsRead) ?? 0,
      total: intOf(c, 'total', d.total) ?? 0, done: intOf(c, 'done', d.done) ?? 0, results: json(d.results, {}),
      planCounts: json(d.planCounts, {}), verify: optJson(d.verify), error: textOf(d.error),
      startedAt: c.moment('started_at', d.startedAt), finishedAt: c.moment('finished_at', d.finishedAt),
      undoneAt: c.moment('undone_at', d.undoneAt), undoneBy: textOf(d.undoneBy), version: intOf(c, 'version', d.__v) ?? 0,
      ...stamp(c, d)
    });
  }

  for (const d of src.spsImportItems) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'sps_import_items', id);
    const runId = linkOf(c, 'run_id', d.runId, runIds, 'run');
    if (!runId) { c.problem('run_id', 'item of no run', 'skipped'); continue; }
    rows.spsImportItems.push({
      id, runId, seq: intOf(c, 'seq', d.seq) ?? 0, key: textOf(d.key), rowNumber: intOf(c, 'row_number', d.rowNumber) ?? 0,
      name: textOf(d.name), action: textOf(d.action), customerId: textOf(idOf(d.customerId) ?? d.customerId),
      connect: boolOf(d.connect), create: optJson(d.create), apply: optJson(d.apply), before: optJson(d.before),
      unset: stringsOf(d.unset), changes: optJson(d.changes ?? []), deleted: optJson(d.deleted), warnings: stringsOf(d.warnings),
      state: textOf(d.state) || 'pending', result: textOf(d.result), reason: textOf(d.reason), createdId: textOf(d.createdId),
      version: intOf(c, 'version', d.__v) ?? 0
    });
  }

  for (const d of src.cloudinaryToS3Backups) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'cloudinary_to_s3_backups', id);
    rows.cloudinaryToS3Backups.push({
      id, runId: textOf(d.runId), collection: textOf(d.collection), docId: textOf(idOf(d.docId) ?? d.docId),
      fields: snapshotJson(obj(d.fields)), at: c.moment('at', d.at)
    });
  }

  for (const d of src.legacyLeads) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'legacy_leads', id);
    rows.legacyLeads.push({
      id, name: textOf(d.name), company: textOf(d.company), email: textOf(d.email), phone: textOf(d.phone), city: textOf(d.city),
      notes: textOf(d.notes), status: textOf(d.status), customerType: optText(d.customerType), priority: optText(d.priority),
      segment: optText(d.segment), modaBinder: optText(d.modaBinder), modaDisplay: optText(d.modaDisplay),
      followUpDate: c.moment('follow_up_date', d.followUpDate), createdBy: idOf(d.createdBy), ...stamp(c, d)
    });
  }

  for (const d of src.legacySalesCustomers) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'legacy_sales_customers', id);
    rows.legacySalesCustomers.push({
      id, userId: idOf(d.userId), customerName: textOf(d.customerName), company: textOf(d.company), address: textOf(d.address),
      phone: textOf(d.phone), email: textOf(d.email), notes: textOf(d.notes), lastVisit: c.moment('last_visit', d.lastVisit),
      nextVisit: c.moment('next_visit', d.nextVisit), status: textOf(d.status), tags: stringsOf(d.tags), ...stamp(c, d)
    });
  }

  return rows;
}
