import type { Request, Response } from 'express';
import type { RouterDependencies } from './serverContracts.ts';
import { handle, parse } from './serverContracts.ts';
import express from 'express';
import { inventoryRevision } from '../services/inventoryTransaction.ts';
import { inPurchasingTransaction, inPurchasingSnapshot, type PurchasingStore } from '../db/purchasing/index.ts';
import { newId } from '../db/ids.ts';
import { reportSalesPeriod } from './salesPeriod.ts';
import { requireAll, HttpError, actorOf } from '../server/http.ts';
import { sourceData, getScope, loadInputs } from './data.ts';
import { buildPlan, stockId } from './buildPlan.ts';
import { z } from 'zod';
import { findShipmentForReceipt, saveReceiptConfirmation } from '../db/inventoryTransit/index.ts';
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
      const result = await inPurchasingSnapshot(async store => {
        const data = await sourceData(req.user, store);
        return { branches: data.branches, cohorts: data.cohorts.map(({ records, legacyId, ...rest }) => ({ ...rest,
          products: [...new Set(records.filter(r => r.uom === 'SF').map(r => r.product))].sort() })),
          scopes: data.scopes, stockSnapshotId: data.stockSnapshotId, stockImportedAt: data.stockImportedAt,
          revision: await inventoryRevision(store.session, store.tx) };
      });
      res.json(result);
    }),
  );
  async function saveScopeInSession(req: Request, id: string | undefined, store: PurchasingStore) {
    const value = parse(scopeSchema, req.body),
      data = await sourceData(req.user, store);
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
    const previousScope = id ? await getScope(id, req.user, store) : null;
    if (previousScope && (previousScope.branches.length !== value.branches.length || previousScope.branches.some(branch => !value.branches.includes(branch)))) {
      if (await store.draftUsesOtherBranch(id!, value.branches))
        throw new HttpError(409, 'Purchase history uses a warehouse being removed. Create a new warehouse view to keep that history with its destination.');
      // Legacy source snapshots inherit their original branch coverage before
      // the view changes; an empty old report cannot establish zero at a new branch.
      await store.stampLegacyInboundBranches(id!, previousScope.branches);
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
      await getScope(id, req.user, store);
      scope = await store.updateScope(id, version, savedFields);
      if (!scope) throw new HttpError(409, 'Scope changed; reload before saving');
    } else scope = await store.createScope(newId(), savedFields);
    return scope;
  }
  async function writeScope(req: Request, res: Response, id?: string) {
    const scope = await inPurchasingTransaction(store => saveScopeInSession(req, id, store));
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
    handle(async (req, res) => res.json(await inPurchasingSnapshot(async store => ({ ...buildPlan(await loadInputs(String(req.params.id), req.user, store), now()), revision: await inventoryRevision(store.session, store.tx) })))),
  );
  router.post(
    '/scopes/:id/inbound',
    requireAll(P.EDIT),
    handle(async (req, res) => {
      const saved = await inPurchasingTransaction(async store => {
        const scope = await getScope(String(req.params.id), req.user, store), body = parse(inboundSchema, req.body);
        if (body.rows.some(r => !scope.branches.includes(r.branch))) throw new HttpError(400, 'Incoming supply must belong to this scope');
        let receipts;
        try { receipts = normalizeInbound(body.rows); } catch (error) { throw new HttpError(400, error instanceof Error ? error.message : 'Invalid incoming supply'); }
        const result = await store.createInbound(newId(), { scopeId: scope._id, ...body, branches: scope.branches, receipts,
          createdAt: now(), importedBy: actorOf(req).name });
        return { id: result._id, rows: body.rows.length, remainingSlabs: receipts.reduce((n, r) => n + r.slabs, 0) };
      });
      req.app.get('io')?.emit('inventory_analysis_update');
      res.status(201).json(saved);
    }),
  );
  router.get(
    '/scopes/:id/inbound',
    handle(async (req, res) => {
      const latest = await inPurchasingSnapshot(async store => {
        const scope = await getScope(String(req.params.id), req.user, store);
        const source = await store.latestInbound(String(req.params.id));
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
    const result = await inPurchasingTransaction(async store => {
      const session = store.session;
      const scope = await getScope(String(req.params.id), req.user, store);
      const shipment = await findShipmentForReceipt(String(req.params.shipmentId), scope.branches, session, store.tx);
      if (!shipment) throw new HttpError(404, 'Shipment not found in this warehouse view');
      const signature = shipment.sourceSignature || transitSignature(shipment as unknown as Parameters<typeof transitSignature>[0]);
      if (signature !== body.signature) throw new HttpError(409, 'The shipment changed; review its current report before confirming a receiving date');
      const actor = actorOf(req);
      await saveReceiptConfirmation(shipment, { date: body.date, signature, at: now(), by: actor.name }, session, store.tx);
      return { success: true, date: body.date };
    });
    req.app.get('io')?.emit('inventory_analysis_update');
    res.json(result);
  }));
  registerDraftRoutes(router, { now });
  return router;
}
