import express from 'express';
import crypto from 'node:crypto';
import Customer from '../models/Customer.js';
import CustomerDeleteBackup from '../models/CustomerDeleteBackup.js';
import SpsImportRun from '../models/SpsImportRun.js';
import SpsImportItem from '../models/SpsImportItem.js';
import { canAddCustomer, canDeleteCustomers, canEditCustomers, canImportCustomers } from '../utils/customerAccess.js';
import { checkSheet } from '../utils/spsSheet.js';
import { planSpsImport, blockersFor, switchesNeeded } from '../utils/spsImportPlan.js';
import { freezePlan, runItems, retryFailed, undoRun } from '../services/spsImportRunner.js';

/**
 * The new SPS customer import (step 5 of the "SPS Import Redesign" artifact).
 * Everything is under /api/customers/sps-import/runs:
 *
 *   POST   /runs                 file (+ mapping)      new draft; the file check runs first, a bad file creates nothing
 *   GET    /runs                                       Import history
 *   GET    /runs/current                               my unfinished draft, or the one running now
 *   GET    /runs/:id                                   status, progress, results, the after-import check
 *   POST   /runs/:id/plan        { mapping, repAliases, branchAliases, answers }  save answers, return the plan
 *   POST   /runs/:id/start                             freeze the plan and write it in the background
 *   POST   /runs/:id/retry                             re-run only what failed
 *   POST   /runs/:id/undo                              put it all back (Import + Delete)
 *   DELETE /runs/:id                                   throw away a draft
 *   GET    /runs/:id/report.csv                        every SPS row and what happened to it
 *   GET    /runs/:id/items?result=&page=&limit=       the customers of a run — added, updated (with what changed), … — a page at a time
 *   GET    /runs/:id/customers?outcome=added|updated   customer ids, for the Customer List filter
 *
 * Needs Import (with View). Connecting an existing customer also needs Edit,
 * bringing a deleted one back needs Add, Undo needs Delete — checked at Start
 * and Undo against what the plan really holds, whatever the screen showed.
 * The server re-plans from the file it saved; nothing the browser sends picks
 * which customer gets written.
 */
export default function createCustomerSpsImportRouter({ authenticate, uploadMemory, readSheet, resolveMapping, buildReference, rememberAliases, fields }) {
  const router = express.Router();
  const BASE = '/sps-import/runs';

  const mayImport = (req, res, next) => (
    canImportCustomers(req.user) ? next() : res.status(403).json({ message: 'Your role can’t import customers.' })
  );
  const who = (req) => req.user?.username || req.user?.name || '';
  const json = (value) => { try { return value ? JSON.parse(value) : {}; } catch { return {}; } };
  const bad = (res, code, message, extra = {}) => res.status(code).json({ message, ...extra });
  const ownerOf = (run) => run.createdBy || 'someone';

  const summary = (run) => ({
    id: String(run._id),
    fileName: run.fileName,
    status: run.status,
    createdBy: run.createdBy,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    rowsRead: run.rowsRead,
    total: run.total,
    done: run.done,
    results: run.results || {},
    planCounts: run.planCounts || {},
    answered: Object.keys(run.answers || {}).length,
    verify: run.verify || null,
    error: run.error || '',
    undoneAt: run.undoneAt,
    undoneBy: run.undoneBy
  });

  /** The plan for a run, read fresh from its saved file and the database as it is now. */
  const computePlan = async (run, { finalize = false } = {}) => {
    const withFile = await SpsImportRun.findById(run._id).select('+file').lean();
    if (!withFile?.file) throw new Error('This import has already started, so it has no file to plan from.');
    const { headers, rows, parse } = await readSheet(Buffer.from(withFile.file.buffer || withFile.file));
    const mapping = resolveMapping(headers, run.mapping || {});
    const fileCheck = checkSheet({ rows, mapping, parse });
    if (!fileCheck.ok) return { fileCheck, headers, mapping };
    const ref = await buildReference({ repAliases: run.repAliases || {}, branchAliases: run.branchAliases || {} });
    const customers = await Customer.find({}, 'company contactName email phone address quickNote salesRep salesRepName location sps').lean();
    const deleted = (await CustomerDeleteBackup.find({ undoneAt: null }).lean()).map((d) => ({ ...d, deletedAt: d.createdAt }));
    const plan = planSpsImport({
      rows, mapping, customers, deleted,
      branchByKey: ref.reference.branchByKey, repByKey: ref.reference.repByKey,
      answers: run.answers || {}, finalize
    });
    return {
      fileCheck, headers, mapping, plan, ref,
      reps: [...ref.repById].map(([id, r]) => ({ _id: id, name: r.salesRepName })).sort((a, b) => a.name.localeCompare(b.name)),
      branches: ref.branches
    };
  };

  const rowsFor = (plan) => {
    const pick = (action, shape) => plan.outcomes.filter((o) => o.action === action).map(shape);
    const common = (o) => ({ key: o.key, rowNumber: o.rowNumber, name: o.name, city: o.city, warnings: o.warnings });
    return {
      decision: pick('decision', (o) => ({ ...common(o), matches: o.matches, sheet: o.sheet })),
      deleted: pick('deleted', (o) => ({ ...common(o), deleted: o.deleted })),
      new: pick('new', (o) => ({ ...common(o), branch: o.create.location || '', rep: o.create.salesRepName || '' })),
      update: [
        ...pick('update', (o) => ({ ...common(o), customerLabel: o.customerLabel, connect: o.connect, changes: o.changes })),
        ...pick('restore', (o) => ({ ...common(o), customerLabel: o.customerLabel, restore: true, changes: o.changes, deleted: o.deleted }))
      ],
      keptDeleted: pick('keptDeleted', (o) => ({ ...common(o), deleted: o.deleted })),
      unchanged: pick('unchanged', (o) => ({ key: o.key, rowNumber: o.rowNumber, name: o.name, city: o.city }))
    };
  };

  // ── drafts ────────────────────────────────────────────────────────────────
  router.post(`${BASE}`, authenticate, mayImport, uploadMemory.single('file'), async (req, res) => {
    if (!req.file) return bad(res, 400, 'No file uploaded');
    try {
      const { headers, rows, parse } = await readSheet(req.file.buffer);
      const mapping = resolveMapping(headers, json(req.body.mapping));
      const fileCheck = checkSheet({ rows, mapping, parse });
      if (!fileCheck.ok) {
        return bad(res, 422, `${fileCheck.blocking.map((b) => b.message).join(' ')} Nothing has been imported.`, { fileCheck });
      }
      const fingerprint = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
      const run = await SpsImportRun.create({
        fileName: req.file.originalname || 'SPS export', fingerprint, file: req.file.buffer,
        createdBy: who(req), mapping: json(req.body.mapping), fileCheck, rowsRead: rows.length
      });
      res.json({ run: summary(run), fileCheck, headers, mapping, fields });
    } catch (err) {
      console.error('SPS import upload error:', err);
      bad(res, 400, `Could not read the file: ${err.message}`);
    }
  });

  router.get(`${BASE}/current`, authenticate, mayImport, async (req, res) => {
    const running = await SpsImportRun.findOne({ status: 'running' }).lean();
    const draft = await SpsImportRun.findOne({ status: 'draft', createdBy: who(req) }).sort({ createdAt: -1 }).lean();
    res.json({ running: running ? summary(running) : null, draft: draft ? summary(draft) : null });
  });

  router.get(`${BASE}`, authenticate, mayImport, async (req, res) => {
    const runs = await SpsImportRun.find({ status: { $ne: 'draft' } }).sort({ createdAt: -1 }).limit(100).lean();
    res.json({ runs: runs.map(summary) });
  });

  router.get(`${BASE}/:id`, authenticate, mayImport, async (req, res) => {
    const run = await SpsImportRun.findById(req.params.id).lean().catch(() => null);
    if (!run) return bad(res, 404, 'No such import.');
    const failed = await SpsImportItem.find({ runId: String(run._id), state: 'failed' }).select('name rowNumber reason').limit(100).lean();
    res.json({ run: summary(run), failed });
  });

  router.delete(`${BASE}/:id`, authenticate, mayImport, async (req, res) => {
    const run = await SpsImportRun.findOne({ _id: req.params.id, status: 'draft' }).catch(() => null);
    if (!run) return bad(res, 404, 'No such draft import.');
    await SpsImportRun.deleteOne({ _id: run._id });
    res.json({ ok: true });
  });

  // ── plan: save the answers, return what the import would do ───────────────
  router.post(`${BASE}/:id/plan`, authenticate, mayImport, express.json({ limit: '5mb' }), async (req, res) => {
    try {
      const run = await SpsImportRun.findOne({ _id: req.params.id, status: 'draft' });
      if (!run) return bad(res, 404, 'No such draft import — it may have started or been discarded.');
      const set = {};
      for (const f of ['mapping', 'repAliases', 'branchAliases', 'answers']) {
        if (req.body?.[f] && typeof req.body[f] === 'object') set[f] = req.body[f];
      }
      if (Object.keys(set).length) await SpsImportRun.updateOne({ _id: run._id }, { $set: set });
      const fresh = await SpsImportRun.findById(run._id).lean();
      const out = await computePlan(fresh);
      if (!out.plan) return bad(res, 422, out.fileCheck.blocking.map((b) => b.message).join(' '), { fileCheck: out.fileCheck });
      const { plan } = out;
      res.json({
        run: summary(fresh),
        fileCheck: out.fileCheck, headers: out.headers, mapping: out.mapping, fields,
        reps: out.reps, branches: out.branches,
        counts: plan.counts, rowsRead: plan.rowsRead, distinct: plan.distinct, skipped: plan.skipped, adds: plan.adds,
        unresolvedReps: plan.unresolvedReps, unresolvedBranches: plan.unresolvedBranches,
        blockers: blockersFor(plan),
        needs: switchesNeeded(plan),
        rows: rowsFor(plan)
      });
    } catch (err) {
      console.error('SPS import plan error:', err);
      bad(res, 400, `Could not plan the import: ${err.message}`);
    }
  });

  // ── start ─────────────────────────────────────────────────────────────────
  router.post(`${BASE}/:id/start`, authenticate, mayImport, async (req, res) => {
    try {
      const busy = await SpsImportRun.findOne({ status: 'running' }).lean();
      if (busy) {
        return bad(res, 409, `${ownerOf(busy)} is importing right now (${busy.done} of ${busy.total}). Try again when it’s finished.`);
      }
      const run = await SpsImportRun.findOne({ _id: req.params.id, status: 'draft' });
      if (!run) return bad(res, 404, 'No such draft import — it may have started already.');
      const out = await computePlan(run.toObject(), { finalize: true });
      if (!out.plan) return bad(res, 422, out.fileCheck.blocking.map((b) => b.message).join(' '), { fileCheck: out.fileCheck });

      const blockers = blockersFor(out.plan);
      if (blockers.length) return bad(res, 422, blockers.join(' '), { blockers });
      const needs = switchesNeeded(out.plan);
      if (needs.edit && !canEditCustomers(req.user)) return bad(res, 403, 'Some customers here connect to existing ones, which needs the Edit customer switch.');
      if (needs.add && !canAddCustomer(req.user)) return bad(res, 403, 'Bringing back a deleted customer needs the Add customer switch.');

      // Claim the run before anything else so two Starts can't both go.
      const claimed = await SpsImportRun.findOneAndUpdate({ _id: run._id, status: 'draft' }, { $set: { status: 'running', createdBy: run.createdBy || who(req) } });
      if (!claimed) return bad(res, 409, 'This import has already started.');

      await freezePlan(run, out.plan, who(req));
      await rememberAliases({ repAliases: run.repAliases || {}, branchAliases: run.branchAliases || {}, repIds: new Set(out.reps.map((r) => r._id)), branches: out.branches, by: who(req) });
      req.app.get('io')?.emit('customer_update');
      runItems(run._id).then(() => req.app.get('io')?.emit('customer_update'));
      res.json({ run: summary(await SpsImportRun.findById(run._id).lean()) });
    } catch (err) {
      console.error('SPS import start error:', err);
      bad(res, 500, `Could not start the import: ${err.message}`);
    }
  });

  router.post(`${BASE}/:id/retry`, authenticate, mayImport, async (req, res) => {
    const run = await SpsImportRun.findOne({ _id: req.params.id, status: { $in: ['done', 'failed'] } }).catch(() => null);
    if (!run) return bad(res, 404, 'Nothing to retry.');
    const n = await retryFailed(run._id);
    res.json({ retrying: n });
  });

  router.post(`${BASE}/:id/undo`, authenticate, mayImport, async (req, res) => {
    if (!canDeleteCustomers(req.user)) return bad(res, 403, 'Undoing an import needs the Delete customer switch.');
    const run = await SpsImportRun.findOne({ _id: req.params.id, status: { $in: ['done', 'failed'] } }).catch(() => null);
    if (!run) return bad(res, 404, 'This import can’t be undone (it isn’t finished, or already was).');
    try {
      const out = await undoRun(run._id, who(req));
      req.app.get('io')?.emit('customer_update');
      res.json(out);
    } catch (err) {
      console.error('SPS import undo error:', err);
      bad(res, 500, `Could not undo the import: ${err.message}`);
    }
  });

  // ── report and the Customer List's filter ─────────────────────────────────
  const csvCell = (v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  router.get(`${BASE}/:id/report.csv`, authenticate, mayImport, async (req, res) => {
    const run = await SpsImportRun.findById(req.params.id).lean().catch(() => null);
    if (!run) return bad(res, 404, 'No such import.');
    const items = await SpsImportItem.find({ runId: String(run._id) }).sort({ seq: 1 }).lean();
    const lines = [['Row', 'SPS customer', 'What happened', 'Easy Stones customer id', 'Changes', 'Note'].map(csvCell).join(',')];
    const words = { added: 'Added', updated: 'Updated', unchanged: 'No changes', restored: 'Brought back', keptDeleted: 'Kept deleted', failed: 'Failed' };
    for (const i of items) {
      lines.push([
        i.rowNumber, i.name, words[i.result] || (i.state === 'pending' ? 'Waiting' : i.result),
        i.createdId || i.customerId,
        (i.changes || []).map((c) => `${c.field}: ${c.from || '—'} → ${c.to}`).join('; '),
        [i.reason, ...(i.warnings || [])].filter(Boolean).join('; ')
      ].map(csvCell).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sps-import-${String(run._id).slice(-6)}.csv"`);
    res.send(`﻿${lines.join('\r\n')}`);
  });

  const RESULTS = ['added', 'updated', 'restored', 'keptDeleted', 'unchanged', 'failed'];
  router.get(`${BASE}/:id/items`, authenticate, mayImport, async (req, res) => {
    const run = await SpsImportRun.findById(req.params.id).select('_id').lean().catch(() => null);
    if (!run) return bad(res, 404, 'No such import.');
    const result = String(req.query.result || '');
    if (result && !RESULTS.includes(result)) return bad(res, 400, 'Unknown result.');
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const page = Math.max(1, Number(req.query.page) || 1);
    const filter = { runId: String(run._id), ...(result ? { result } : { result: { $ne: '' } }) };
    const [total, items] = await Promise.all([
      SpsImportItem.countDocuments(filter),
      SpsImportItem.find(filter).sort({ seq: 1 }).skip((page - 1) * limit).limit(limit)
        .select('rowNumber name result reason changes warnings createdId customerId connect create.company create.location create.salesRepName create.address.city').lean()
    ]);
    res.json({
      total,
      items: items.map((i) => ({
        rowNumber: i.rowNumber, name: i.name, result: i.result, reason: i.reason || '',
        customerId: i.createdId || i.customerId || '', connect: !!i.connect,
        changes: (i.changes || []).map((c) => ({ field: c.field, from: c.from, to: c.to instanceof Object ? '' : String(c.to) })),
        warnings: i.warnings || [],
        added: i.create ? { city: i.create.address?.city || '', branch: i.create.location || '', rep: i.create.salesRepName || '' } : null
      }))
    });
  });

  router.get(`${BASE}/:id/customers`, authenticate, mayImport, async (req, res) => {
    const results = req.query.outcome === 'added' ? ['added', 'restored'] : req.query.outcome === 'updated' ? ['updated'] : ['added', 'restored', 'updated'];
    const items = await SpsImportItem.find({ runId: req.params.id, result: { $in: results } }).select('createdId customerId').lean();
    res.json({ ids: items.map((i) => i.createdId || i.customerId).filter(Boolean) });
  });

  return router;
}
