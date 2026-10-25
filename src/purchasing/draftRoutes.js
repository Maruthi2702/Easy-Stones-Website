import { requireAll, handle, parse, HttpError, actorOf, inTransaction } from '../server/http.js';
import { PurchasingDraft, PurchasingLock, PurchasingPoLink } from './models.js';
import { getScope, loadInputs } from './data.js';
import { buildPlan } from './buildPlan.js';
import { draftSchema, actionSchema } from './schemas.js';
import { packContainers, variantKey } from './planning.ts';
const edit = requireAll('manage_purchasing'),
  approve = requireAll('approve_purchasing');
const idOf = (req) => {
  if (!/^[a-f\d]{24}$/i.test(req.params.draftId)) throw new HttpError(400, 'Invalid draft');
  return req.params.draftId;
};
export function registerDraftRoutes(router, { now }) {
  router.get(
    '/drafts/:draftId/export',
    approve,
    handle(async (req, res) => {
      const draft = await PurchasingDraft.findById(idOf(req)).lean();
      if (!draft || draft.status !== 'approved')
        throw new HttpError(409, 'Only approved drafts can be exported');
      const inputs = await loadInputs(String(draft.scopeId), req.user);
      inputs.locks = inputs.locks.filter((l) => String(l.draftId) !== String(draft._id));
      const current = buildPlan(inputs, now());
      if (
        current.fingerprint !== draft.fingerprint ||
        draft.lines.some((l) => current.rows.find((r) => r.key === l.key)?.blockers.length !== 0)
      )
        throw new HttpError(409, 'Planning inputs changed; cancel and recreate this draft before export');
      res.json(draft);
    }),
  );
  router.get(
    '/scopes/:id/drafts',
    handle(async (req, res) => {
      await getScope(req.params.id, req.user);
      res.json(
        await PurchasingDraft.find({ scopeId: req.params.id }).sort({ createdAt: -1 }).limit(100).lean(),
      );
    }),
  );
  router.post(
    '/scopes/:id/drafts',
    edit,
    handle(async (req, res) => {
      const body = parse(draftSchema, req.body),
        inputs = await loadInputs(req.params.id, req.user),
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
        loads = packContainers(lines, plan.scope.container);
      } catch (error) {
        throw new HttpError(400, error.message);
      }
      const actor = actorOf(req);
      const draft = await inTransaction(async (session) => {
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
                receipts: inputs.inbound?.receipts || [],
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
      res.status(201).json(draft);
    }),
  );
  for (const action of ['approve', 'cancel', 'link'])
    router.post(
      `/drafts/:draftId/${action}`,
      approve,
      handle(async (req, res) => {
        const body = parse(actionSchema, req.body),
          draft = await PurchasingDraft.findById(idOf(req)).lean();
        if (!draft) throw new HttpError(404, 'Draft not found');
        const scope = await getScope(String(draft.scopeId), req.user);
        const inputs = await loadInputs(String(scope._id), req.user);
        // Own draft locks are deliberately ignored for revalidation; other buyers'
        // locks remain blockers. Data/policy changes always invalidate approval.
        inputs.locks = inputs.locks.filter((l) => String(l.draftId) !== String(draft._id));
        const current = buildPlan(inputs, now());
        if (action === 'approve') {
          if (draft.status !== 'draft') throw new HttpError(409, 'Only a pending draft can be approved');
          if (
            current.fingerprint !== draft.fingerprint ||
            draft.lines.some((l) => current.rows.find((r) => r.key === l.key)?.blockers.length !== 0)
          )
            throw new HttpError(
              409,
              'Stock, sales, inbound supply or policy changed; cancel and recreate this draft',
            );
          packContainers(draft.lines, current.scope.container);
        }
        if (action === 'cancel' && !['draft', 'approved'].includes(draft.status))
          throw new HttpError(409, 'Only active drafts can be cancelled');
        const linked = [];
        if (action === 'link') {
          if (draft.status !== 'approved')
            throw new HttpError(409, 'Approve this draft before recording its SPS order');
          const wanted = new Set(body.poLines || []),
            parents = new Map();
          if ([...wanted].some((key) => draft.existingPoLines?.includes(key)))
            throw new HttpError(
              400,
              'Link new SPS PO lines created for this draft, not supply already present when it was calculated',
            );
          for (const row of inputs.inbound?.rows || []) parents.set(JSON.stringify([row.po, row.line]), row);
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
            linked.push(...matches.map(([key]) => key));
          }
          if (new Set(linked).size !== wanted.size)
            throw new HttpError(400, 'Select only SPS lines that cover the draft variants');
        }
        const status = { approve: 'approved', cancel: 'cancelled', link: 'ordered' }[action],
          actor = actorOf(req);
        const updated = await inTransaction(async (session) => {
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
        res.json(updated);
      }),
    );
}
