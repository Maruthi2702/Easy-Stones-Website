import type { Request, Router } from 'express';
import type { InboundRow, DraftLine } from './types.ts';
import { handle, parse } from './serverContracts.ts';
import { inInventoryTransaction, inInventorySnapshot } from '../services/inventoryTransaction.ts';
import { transitParentIdentity, existingTransitParents } from './purchaseIdentity.ts';
import { requireAll, HttpError, actorOf } from '../server/http.ts';
import { PurchasingDraft, PurchasingLock, PurchasingPoLink } from './models.ts';
import { getScope, loadInputs } from './data.ts';
import { buildPlan } from './buildPlan.ts';
import { draftSchema, actionSchema } from './schemas.ts';
import { packContainers, variantKey } from './planning.ts';
const edit = requireAll('manage_purchasing'),
  approve = requireAll('approve_purchasing');
const idOf = (req: Request) => {
  if (!/^[a-f\d]{24}$/i.test(String(req.params.draftId))) throw new HttpError(400, 'Invalid draft');
  return String(req.params.draftId);
};
export function registerDraftRoutes(router: Router, { now }: { now: () => Date }) {
  router.get(
    '/drafts/:draftId/export',
    approve,
    handle(async (req, res) => {
      const result = await inInventorySnapshot(async session => {
      const draft = await PurchasingDraft.findById(idOf(req)).session(session).lean();
      if (!draft || draft.status !== 'approved')
        throw new HttpError(409, 'Only approved drafts can be exported');
      const inputs = await loadInputs(String(draft.scopeId), req.user, session);
      inputs.locks = inputs.locks.filter((l) => String(l.draftId) !== String(draft._id));
      const current = buildPlan(inputs, now());
      if (
        current.fingerprint !== draft.fingerprint ||
        draft.lines.some((l: DraftLine) => current.rows.find((r) => r.key === l.key)?.blockers.length !== 0)
      )
        throw new HttpError(409, 'Planning inputs changed; cancel and recreate this draft before export');
      return draft;
      });
      res.json(result);
    }),
  );
  router.get(
    '/scopes/:id/drafts',
    handle(async (req, res) => {
      const result = await inInventorySnapshot(async session => {
      await getScope(String(req.params.id), req.user, session);
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
      if (req.query.cursor && !/^[a-f\d]{24}$/i.test(String(req.query.cursor))) throw new HttpError(400, 'Invalid draft cursor');
      const filter = { scopeId: String(req.params.id), ...(req.query.cursor ? { _id: { $lt: String(req.query.cursor) } } : {}) };
      if (req.query.paginated === 'true') {
        const active = req.query.cursor ? [] : await PurchasingDraft.find({ scopeId: String(req.params.id), status: { $in: ['draft', 'approved'] } }).session(session).sort({ _id: -1 }).lean();
        const found = await PurchasingDraft.find({ ...filter, status: { $nin: ['draft', 'approved'] } }).session(session).sort({ _id: -1 }).limit(limit + 1).lean();
        const hasMore = found.length > limit, history = found.slice(0, limit);
        return { items: [...active, ...history], nextCursor: hasMore ? String(history.at(-1)!._id) : null };
      } else {
        // Compatibility for cached clients: never hide an older active draft.
        const active = await PurchasingDraft.find({ scopeId: String(req.params.id), status: { $in: ['draft', 'approved'] } }).session(session).sort({ _id: -1 }).lean();
        const history = await PurchasingDraft.find({ scopeId: String(req.params.id), status: { $nin: ['draft', 'approved'] } }).session(session).sort({ _id: -1 }).limit(100).lean();
        return [...active, ...history];
      }
      });
      res.json(result);
    }),
  );
  router.post(
    '/scopes/:id/drafts',
    edit,
    handle(async (req, res) => {
      const body = parse(draftSchema, req.body);
      const draft = await inInventoryTransaction(async session => {
      const inputs = await loadInputs(String(req.params.id), req.user, session),
        plan = buildPlan(inputs, now());
      if (body.fingerprint !== plan.fingerprint)
        throw new HttpError(409, 'Planning inputs changed; refresh the recommendations');
      const lines = body.lines.map((input) => {
        const row = plan.rows.find((r) => r.key === input.key);
        if (!row || row.blockers.length || !row.protective || !row.policy?.active)
          throw new HttpError(409, `${row?.product || input.key}: resolve planning inputs before drafting`);
        if (!plan.scope.branches.includes(input.branch))
          throw new HttpError(400, 'Choose a receiving branch in this planning scope');
        if (input.quantity < row.policy.minimumSlabs)
          throw new HttpError(400, `${row.product}: quantity is below the supplier minimum`);
        if (input.quantity % row.policy.bundleSlabs !== 0)
          throw new HttpError(400, `${row.product}: use whole bundles`);
        if (input.quantity !== row.protective.proposedSlabs && !body.note.trim())
          throw new HttpError(400, 'Explain every quantity override in the buyer note');
        return {
          key: row.key,
          product: row.product,
          branch: input.branch,
          quantity: input.quantity,
          supplier: row.policy.supplier,
          mixGroup: row.policy.mixGroup,
          bundleSlabs: row.policy.bundleSlabs,
          weightKg: row.policy.weightKg,
          requiredOn: row.protective.bufferBreachOn,
        };
      });
      if (new Set(lines.map((l) => l.key)).size !== lines.length)
        throw new HttpError(400, 'Include each variant once; use one explicit receiving branch');
      let loads;
      try {
        if (!plan.scope.container) throw new Error('Confirm the container payload and slab layout');
        loads = packContainers(lines, plan.scope.container);
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : 'Invalid container load');
      }
      const actor = actorOf(req);
        const [doc] = await PurchasingDraft.create(
          [
            {
              scopeId: plan.scope._id,
              fingerprint: plan.fingerprint,
              inputSnapshot: {
                today: plan.today,
                scope: plan.scope,
                cohort: plan.cohort,
                stockImportedAt: plan.stockImportedAt,
                stockSnapshotId: plan.stockSnapshotId,
                inboundImportedAt: plan.inboundImportedAt,
                receipts: plan.rows.flatMap(row => row.receipts || []),
                rows: plan.rows
                  .filter((r) => body.lines.some((l) => l.key === r.key))
                  .map((r) => ({
                    product: r.product,
                    readyQuantity: r.readyQuantity,
                    readySlabs: r.readySlabs,
                    baseline: r.baseline,
                    protective: r.protective,
                    policy: r.policy,
                  })),
              },
              existingTransitParents: [...new Set(plan.rows.flatMap(row => (row.transit || [])
                .filter(t => t.poNumber).map(t => transitParentIdentity(t.poNumber, row.product, t.branch, t.supplier))))],
              existingPoLines: [
                ...new Set((inputs.inbound?.rows || []).map((r) => JSON.stringify([r.po, r.line]))),
              ],
              lines,
              loads,
              note: body.note,
              status: 'draft',
              createdBy: actor,
              history: [{ action: 'draft', at: now(), name: actor.name, note: body.note }],
            },
          ],
          { session },
        );
        await PurchasingLock.insertMany(
          lines.flatMap((line) =>
            plan.scope.branches.map((branch) => ({
              _id: JSON.stringify([
                branch,
                variantKey(
                  plan.scope.aliases.find((a) => variantKey(a.salesProduct) === variantKey(line.product))
                    ?.stockProduct || line.product,
                ),
              ]),
              scopeId: plan.scope._id,
              draftId: doc._id,
            })),
          ),
          { session },
        );
        return doc;
      });
      req.app.get('io')?.emit('inventory_analysis_update');
      res.status(201).json(draft);
    }),
  );
  for (const action of ['approve', 'cancel', 'link'])
    router.post(
      `/drafts/:draftId/${action}`,
      approve,
      handle(async (req, res) => {
        const body = parse(actionSchema, req.body);
        const updated = await inInventoryTransaction(async session => {
        const draft = await PurchasingDraft.findById(idOf(req)).session(session).lean();
        if (!draft) throw new HttpError(404, 'Draft not found');
        const scope = await getScope(String(draft.scopeId), req.user, session);
        const inputs = action === 'cancel' ? null : await loadInputs(String(scope._id), req.user, session);
        // Own draft locks are deliberately ignored for revalidation; other buyers'
        // locks remain blockers. Data/policy changes always invalidate approval.
        if (inputs) inputs.locks = inputs.locks.filter((l) => String(l.draftId) !== String(draft._id));
        if (action === 'approve') {
          if (!inputs) throw new Error('Approval inputs are unavailable');
          const current = buildPlan(inputs, now());
          if (draft.status !== 'draft') throw new HttpError(409, 'Only a pending draft can be approved');
          if (
            current.fingerprint !== draft.fingerprint ||
            draft.lines.some((l: DraftLine) => current.rows.find((r) => r.key === l.key)?.blockers.length !== 0)
          )
            throw new HttpError(
              409,
              'Stock, sales, inbound supply or policy changed; cancel and recreate this draft',
            );
          if (!current.scope.container) throw new HttpError(400, 'Confirm the container payload and slab layout');
          packContainers(draft.lines, current.scope.container);
        }
        if (action === 'cancel' && !['draft', 'approved'].includes(draft.status))
          throw new HttpError(409, 'Only active drafts can be cancelled');
        const linked: string[] = [];
        if (action === 'link') {
          if (draft.status !== 'approved')
            throw new HttpError(409, 'Approve this draft before recording its SPS order');
          const wanted = new Set(body.poLines || []), parents = new Map<string, InboundRow>();
          const previousTransit = existingTransitParents(draft);
          if ([...wanted].some((key) => draft.existingPoLines?.includes(key)))
            throw new HttpError(
              400,
              'Link new SPS PO lines created for this draft, not supply already present when it was calculated',
            );
          for (const row of inputs!.inbound?.rows || []) parents.set(JSON.stringify([row.po, row.line]), row);
          for (const line of draft.lines) {
            const matches = [...parents].filter(
              ([key, r]) =>
                wanted.has(key) &&
                r.branch === line.branch &&
                variantKey(
                  scope.aliases.find((a) => variantKey(a.stockProduct) === variantKey(r.product))
                    ?.salesProduct || r.product,
                ) === variantKey(line.product) &&
                r.supplier === line.supplier,
            );
            if (matches.reduce((n, [, r]) => n + r.ordered - r.cancelled, 0) < line.quantity)
              throw new HttpError(
                400,
                `${line.product}: imported SPS PO lines do not cover this draft quantity`,
              );
            if (matches.some(([, r]) => previousTransit.has(transitParentIdentity(r.po, line.product, r.branch, r.supplier))))
              throw new HttpError(409, 'This PO was already counted in the original transit report; link a new SPS order, not existing incoming supply');
            linked.push(...matches.map(([key]) => key));
          }
          if (new Set(linked).size !== wanted.size)
            throw new HttpError(400, 'Select only SPS lines that cover the draft variants');
        }
        const status = { approve: 'approved', cancel: 'cancelled', link: 'ordered' }[action],
          actor = actorOf(req);
          const doc = await PurchasingDraft.findOneAndUpdate(
            { _id: draft._id, __v: body.version, status: draft.status },
            {
              $set: { status, ...(action === 'link' ? { linkedPoLines: [...new Set(linked)] } : {}) },
              $inc: { __v: 1 },
              $push: { history: { action, at: now(), name: actor.name, note: body.note } },
            },
            { session, returnDocument: 'after' },
          );
          if (!doc) throw new HttpError(409, 'This draft changed; reload before trying again');
          if (action === 'link')
            await PurchasingPoLink.insertMany(
              [...new Set(linked)].map((key) => ({ _id: key, draftId: draft._id })),
              { session },
            );
          if (action !== 'approve') await PurchasingLock.deleteMany({ draftId: draft._id }, { session });
          return doc;
        });
        req.app.get('io')?.emit('inventory_analysis_update');
        res.json(updated);
      }),
    );
}
