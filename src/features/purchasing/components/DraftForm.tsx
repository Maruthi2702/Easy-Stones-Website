import { useState } from 'react';
import FormModal from '../../../components/shared/form/FormModal';
import type { Plan, PlanRow } from '../../../purchasing/types';
import { purchasingApi } from '../purchasingApi';
export default function DraftForm({
  plan,
  rows,
  onClose,
  onSaved,
}: {
  plan: Plan;
  rows: PlanRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [openedFingerprint] = useState(plan.fingerprint);
  const [lines, setLines] = useState(
      rows.map((r) => ({
        key: r.key,
        product: r.product,
        branch: plan.scope.branches.length === 1 ? plan.scope.branches[0] : '',
        quantity: r.protective?.proposedSlabs || 0,
      })),
    ),
    [note, setNote] = useState(''),
    [error, setError] = useState(''),
    [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    setError('');
    try {
      await purchasingApi.createDraft(plan.scope._id, {
        fingerprint: openedFingerprint,
        lines: lines.map(({ product, ...rest }) => rest),
        note,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create draft');
    } finally {
      setSaving(false);
    }
  }
  return (
    <FormModal
      title="Draft container buy · 90-day case"
      size="l"
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      saving={saving}
      submitLabel="Calculate loads & save draft"
      dirtyCount={1}
    >
      <div className="purchase-form">
        {error && (
          <p role="alert" className="purchase-error">
            {error}
          </p>
        )}
        <p>
          Choose an explicit receiving branch for every variant. Combined sales are not automatically
          allocated between branches. Quantity overrides require a buyer note. This saves an internal draft
          and reserves these variants against duplicate buying; it does not place an SPS order.
        </p>
        {lines.map((line, i) => (
          <fieldset key={line.key}>
            <legend>{line.product}</legend>
            <div className="purchase-fields">
              <label>
                Receiving branch
                <select
                  required
                  value={line.branch}
                  onChange={(e) =>
                    setLines((s) => s.map((x, n) => (n === i ? { ...x, branch: e.target.value } : x)))
                  }
                >
                  <option value="">Choose destination</option>
                  {plan.scope.branches.map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </select>
              </label>
              <label>
                Full slabs
                <input
                  required
                  type="number"
                  min="1"
                  max="100000"
                  step={rows[i]?.policy?.bundleSlabs || 1}
                  value={line.quantity}
                  onChange={(e) =>
                    setLines((s) =>
                      s.map((x, n) => (n === i ? { ...x, quantity: Number(e.target.value) } : x)),
                    )
                  }
                />
              </label>
            </div>
          </fieldset>
        ))}
        <label>
          Buyer note / quantity override reason
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
        </label>
        <p className="purchase-muted">
          Loads use supplier, destination and approved mix group. Payload includes rack tare. Slot and payload
          limits must both pass. Unfilled space never adds filler demand.
        </p>
      </div>
    </FormModal>
  );
}
