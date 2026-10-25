import type { Request, Response } from 'express';
import type { ClientSession } from 'mongoose';
import type { RouterDependencies } from './serverContracts.ts';
import { handle, parse } from './serverContracts.ts';
import express from 'express';
import { inInventoryTransaction, inInventorySnapshot, inventoryRevision } from '../services/inventoryTransaction.ts';
import { reportSalesPeriod } from './salesPeriod.ts';
import { requireAll, HttpError, actorOf } from '../server/http.js';
import { PurchasingScope, PurchasingInbound, PurchasingDraft, PurchasingLock } from './models.ts';
import { sourceData, getScope, loadInputs } from './data.ts';
import { buildPlan, stockId } from './buildPlan.ts';
import { z } from 'zod';
import InventoryTransitShipment from '../models/InventoryTransitShipment.ts';
import { InventoryTransitEvent } from '../models/InventoryTransitReport.ts';
import { transitSignature } from './transitSignature.ts';
import { normalizeInbound, variantKey, todayPacific, validDay } from './planning.ts';
import { scopeSchema, inboundSchema } from './schemas.ts';
import { registerDraftRoutes } from './draftRoutes.ts';
export const P = { VIEW: 'view_purchasing', EDIT: 'manage_purchasing', APPROVE: 'approve_purchasing' };
export default function createPurchasingRouter({ authenticate, now = () => new Date() }: RouterDependencies) {
  const router = express.Router();
  router.use(authenticate, requireAll('view_inventory_analysis', P.VIEW));
  router.get('/revision', handle(async (req, res) => res.json({ revision: await inventoryRevision() })));
  router.get(
    '/metadata',
    handle(async (req, res) => {
      const result = await inInventorySnapshot(async session => {
        const data = await sourceData(req.user, session);
        return { branches: data.branches, cohorts: data.cohorts.map(({ records, legacyId, ...rest }) => ({ ...rest,
          products: [...new Set(records.filter(r => r.uom === 'SF').map(r => r.product))].sort() })),
          scopes: data.scopes, stockSnapshotId: data.stockSnapshotId, stockImportedAt: data.stockImportedAt,
          revision: await inventoryRevision(session) };
      });
      res.json(result);
    }),
  );
  async function saveScopeInSession(req: Request, id: string | undefined, session: ClientSession) {
    const value = parse(scopeSchema, req.body),
      data = await sourceData(req.user, session);
    if (value.branches.some((b) => !data.branches.includes(b)))
      throw new HttpError(403, 'Choose only branches in your access');
    const cohort = data.cohorts.find((c) => c.id === value.cohortId || c.legacyId === value.cohortId);
    if (!cohort) throw new HttpError(409, 'Sales report changed; refresh the source list');
    value.cohortId = cohort.id;
    if (
      data.branches.includes(cohort.location) &&
      (value.branches.length !== 1 || value.branches[0] !== cohort.location)
    )
      throw new HttpError(400, 'A single-branch sales report must use that same branch');
    if (
      value.observedThrough && (value.observedThrough > todayPacific(now()) ||
      value.observedThrough < cohort.start ||
      value.observedThrough > cohort.end)
    )
      throw new HttpError(400, `Observed cutoff must be inside the report range and no later than today`);
    const period = reportSalesPeriod(cohort, todayPacific(now()), value.observedThrough);
    if (period.errors.length) throw new HttpError(400, period.errors[0]);
    value.observedThrough = period.through;
    if (value.stockCoverageConfirmed && value.stockSnapshotId !== data.stockSnapshotId)
      throw new HttpError(409, 'Stock changed while editing; refresh before confirming coverage');
    value.stockSnapshotId = stockId(data.stock.filter((s) => value.branches.includes(s.location)));
    const previousScope = id ? await getScope(id, req.user, session) : null;
    if (previousScope && (previousScope.branches.length !== value.branches.length || previousScope.branches.some(branch => !value.branches.includes(branch)))) {
      if (await PurchasingDraft.exists({ scopeId: id, lines: { $elemMatch: { branch: { $nin: value.branches } } } }).session(session))
        throw new HttpError(409, 'Purchase history uses a warehouse being removed. Create a new warehouse view to keep that history with its destination.');
      // Legacy source snapshots inherit their original branch coverage before
      // the view changes; an empty old report cannot establish zero at a new branch.
      await PurchasingInbound.updateMany({ scopeId: id, branches: { $exists: false } }, { $set: { branches: previousScope.branches } }, { session });
    }
    for (const alias of value.aliases) {
      if (!cohort.records.some((r) => variantKey(r.product) === variantKey(alias.salesProduct)))
        throw new HttpError(400, 'Alias sales product must exist in the selected report');
      const currentStock = data.stock.some(
        (r) =>
          value.branches.includes(r.location) && variantKey(r.product) === variantKey(alias.stockProduct),
      );
      const previouslyVerified = previousScope?.aliases.some(
        (a) =>
          variantKey(a.stockProduct) === variantKey(alias.stockProduct) &&
          variantKey(a.salesProduct) === variantKey(alias.salesProduct),
      );
      if (!currentStock && !previouslyVerified)
        throw new HttpError(
          400,
          'Verify each new alias against an existing stock product; an unmatched name cannot establish zero stock',
        );

      if (
        cohort.records.some(
          (r) =>
            variantKey(r.product) === variantKey(alias.stockProduct) &&
            variantKey(r.product) !== variantKey(alias.salesProduct),
        )
      )
        throw new HttpError(400, 'A stock alias cannot consume another sales variant in the same report');
    }
    const { version, salesCoverageDateConfirmed: _legacyDateConfirmation, ...fields } = value;
    const actor = actorOf(req);
    // Legacy date confirmations remain audit history; uploaded report dates
    // now determine the sales denominator without a confirmation requirement.
    const savedFields = { ...fields, updatedBy: actor.name, cohortRevision: value.fullSalesCoverage ? cohort.revision : null };
    let scope;
    if (id) {
      await getScope(id, req.user, session);
      scope = await PurchasingScope.findOneAndUpdate(
        { _id: id, __v: version },
        { $set: savedFields, $inc: { __v: 1 } },
        { session, returnDocument: 'after' },
      );
      if (!scope) throw new HttpError(409, 'Scope changed; reload before saving');
    } else [scope] = await PurchasingScope.create([savedFields], { session });
    return scope;
  }
  async function writeScope(req: Request, res: Response, id?: string) {
    const scope = await inInventoryTransaction(session => saveScopeInSession(req, id, session));
    req.app.get('io')?.emit('inventory_analysis_update');
    res.status(id ? 200 : 201).json(scope);
  }
  router.post(
    '/scopes',
    requireAll(P.EDIT),
    handle((req, res) => writeScope(req, res)),
  );
  router.put(
    '/scopes/:id',
    requireAll(P.EDIT),
    handle((req, res) => writeScope(req, res, String(req.params.id))),
  );
  router.get(
    '/scopes/:id/plan',
    handle(async (req, res) => res.json(await inInventorySnapshot(async session => ({ ...buildPlan(await loadInputs(String(req.params.id), req.user, session), now()), revision: await inventoryRevision(session) })))),
  );
  router.post(
    '/scopes/:id/inbound',
    requireAll(P.EDIT),
    handle(async (req, res) => {
      const saved = await inInventoryTransaction(async session => {
        const scope = await getScope(String(req.params.id), req.user, session), body = parse(inboundSchema, req.body);
        if (body.rows.some(r => !scope.branches.includes(r.branch))) throw new HttpError(400, 'Incoming supply must belong to this scope');
        let receipts;
        try { receipts = normalizeInbound(body.rows); } catch (error) { throw new HttpError(400, error instanceof Error ? error.message : 'Invalid incoming supply'); }
        const [result] = await PurchasingInbound.create([{ scopeId: scope._id, ...body, branches: scope.branches, receipts,
          createdAt: now(), importedBy: actorOf(req).name }], { session });
        return { id: result._id, rows: body.rows.length, remainingSlabs: receipts.reduce((n, r) => n + r.slabs, 0) };
      });
      req.app.get('io')?.emit('inventory_analysis_update');
      res.status(201).json(saved);
    }),
  );
  router.get(
    '/scopes/:id/inbound',
    handle(async (req, res) => {
      const latest = await inInventorySnapshot(async session => {
        const scope = await getScope(String(req.params.id), req.user, session);
        const source = await PurchasingInbound.findOne({ scopeId: String(req.params.id) }).session(session)
          .sort({ createdAt: -1, _id: -1 }).lean();
        if (source?.branches && (source.branches.length !== scope.branches.length || source.branches.some((branch: string) => !scope.branches.includes(branch)))) return null;
        return source;
      });
      res.json(latest || null);
    }),
  );
  router.post('/scopes/:id/incoming/:shipmentId/receipt', requireAll(P.EDIT), handle(async (req, res) => {
    const body = parse(z.object({ date: z.string().refine(validDay), signature: z.string().length(64) }).strict(), req.body);
    if (!/^[a-f\d]{24}$/i.test(String(req.params.shipmentId))) throw new HttpError(400, 'Invalid shipment');
    if (body.date < todayPacific(now())) throw new HttpError(400, 'Choose a current or future expected warehouse receipt date');
    const result = await inInventoryTransaction(async session => {
      const scope = await getScope(String(req.params.id), req.user, session);
      const shipment = await InventoryTransitShipment.findOne({ _id: String(req.params.shipmentId),
        location: { $in: scope.branches }, active: { $ne: false } }).session(session).lean();
      if (!shipment) throw new HttpError(404, 'Shipment not found in this warehouse view');
      const signature = shipment.sourceSignature || transitSignature(shipment);
      if (signature !== body.signature) throw new HttpError(409, 'The shipment changed; review its current report before confirming a receiving date');
      const actor = actorOf(req);
      await InventoryTransitShipment.updateOne({ _id: shipment._id }, { $set: { usableReceiptDate: new Date(body.date),
        receiptConfirmedAt: now(), receiptConfirmedBy: actor.name, confirmedSignature: signature }, $inc: { __v: 1 } }, { session });
      await InventoryTransitEvent.create([{ shipmentId: String(shipment._id), at: now(), actor: actor.name,
        action: 'receipt-confirmed', snapshot: { date: body.date, signature } }], { session });
      return { success: true, date: body.date };
    });
    req.app.get('io')?.emit('inventory_analysis_update');
    res.json(result);
  }));
  registerDraftRoutes(router, { now });
  return router;
}
