import express from 'express';
import { requireAll, handle, parse, HttpError, actorOf, inTransaction } from '../server/http.js';
import { PurchasingScope, PurchasingInbound, PurchasingDraft, PurchasingLock } from './models.js';
import { sourceData, getScope, loadInputs } from './data.js';
import { buildPlan, stockId } from './buildPlan.js';
import { normalizeInbound, variantKey, todayPacific } from './planning.ts';
import { scopeSchema, inboundSchema } from './schemas.js';
import { registerDraftRoutes } from './draftRoutes.js';
export const P = { VIEW: 'view_purchasing', EDIT: 'manage_purchasing', APPROVE: 'approve_purchasing' };
export default function createPurchasingRouter({ authenticate, now = () => new Date() }) {
  const router = express.Router();
  router.use(authenticate, requireAll('view_inventory_analysis', P.VIEW));
  router.get(
    '/metadata',
    handle(async (req, res) => {
      const data = await sourceData(req.user);
      res.json({
        branches: data.branches,
        cohorts: data.cohorts.map(({ records, ...rest }) => ({
          ...rest,
          products: [...new Set(records.filter((r) => r.uom === 'SF').map((r) => r.product))].sort(),
        })),
        scopes: data.scopes,
        stockSnapshotId: data.stockSnapshotId,
        stockImportedAt: data.stockImportedAt,
      });
    }),
  );
  async function writeScope(req, res, id) {
    const value = parse(scopeSchema, req.body),
      data = await sourceData(req.user);
    if (value.branches.some((b) => !data.branches.includes(b)))
      throw new HttpError(403, 'Choose only branches in your access');
    const cohort = data.cohorts.find((c) => c.id === value.cohortId);
    if (!cohort) throw new HttpError(409, 'Sales cohort changed; refresh the source list');
    if (
      data.branches.includes(cohort.location) &&
      (value.branches.length !== 1 || value.branches[0] !== cohort.location)
    )
      throw new HttpError(400, 'A single-branch sales report must use that same branch');
    if (
      value.observedThrough > todayPacific(now()) ||
      value.observedThrough < cohort.start ||
      value.observedThrough > cohort.end
    )
      throw new HttpError(400, 'Observed cutoff must be inside the report range and no later than today');
    if (value.stockCoverageConfirmed && value.stockSnapshotId !== data.stockSnapshotId)
      throw new HttpError(409, 'Stock changed while editing; refresh before confirming coverage');
    value.stockSnapshotId = stockId(data.stock.filter((s) => value.branches.includes(s.location)));
    const previousScope = id ? await getScope(id, req.user) : null;
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
    const { version, ...fields } = value;
    fields.updatedBy = actorOf(req).name;
    let scope;
    if (id) {
      await getScope(id, req.user);
      scope = await PurchasingScope.findOneAndUpdate(
        { _id: id, __v: version },
        { $set: fields, $inc: { __v: 1 } },
        { returnDocument: 'after' },
      );
      if (!scope) throw new HttpError(409, 'Scope changed; reload before saving');
    } else scope = await PurchasingScope.create(fields);
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
    handle((req, res) => writeScope(req, res, req.params.id)),
  );
  router.get(
    '/scopes/:id/plan',
    handle(async (req, res) => res.json(buildPlan(await loadInputs(req.params.id, req.user), now()))),
  );
  router.post(
    '/scopes/:id/inbound',
    requireAll(P.EDIT),
    handle(async (req, res) => {
      const scope = await getScope(req.params.id, req.user),
        body = parse(inboundSchema, req.body);
      if (body.rows.some((r) => !scope.branches.includes(r.branch)))
        throw new HttpError(400, 'Incoming supply must belong to this scope');
      let receipts;
      try {
        receipts = normalizeInbound(body.rows);
      } catch (error) {
        throw new HttpError(400, error.message);
      }
      const result = await PurchasingInbound.create({
        scopeId: scope._id,
        ...body,
        receipts,
        createdAt: now(),
        importedBy: actorOf(req).name,
      });
      res.status(201).json({
        id: result._id,
        rows: body.rows.length,
        remainingSlabs: receipts.reduce((n, r) => n + r.slabs, 0),
      });
    }),
  );
  router.get(
    '/scopes/:id/inbound',
    handle(async (req, res) => {
      await getScope(req.params.id, req.user);
      const latest = await PurchasingInbound.findOne({ scopeId: req.params.id })
        .sort({ createdAt: -1, _id: -1 })
        .lean();
      res.json(latest || null);
    }),
  );
  registerDraftRoutes(router, { now });
  return router;
}
