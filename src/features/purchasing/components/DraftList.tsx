import { useState } from 'react';
import type { Draft, InboundRow } from '../../../purchasing/types';
import FormModal from '../../../components/shared/form/FormModal';
import { purchasingApi, download, csv } from '../purchasingApi';
import { num } from './BuyerQueue';
export default function DraftList({
  drafts,
  inbound,
  canApprove,
  onChanged,
}: {
  drafts: Draft[];
  inbound: InboundRow[];
  canApprove: boolean;
  onChanged: () => void;
}) {
  const [action, setAction] = useState<{ draft: Draft; action: 'approve' | 'cancel' | 'link' } | null>(null),
    [note, setNote] = useState(''),
    [selected, setSelected] = useState<string[]>([]),
    [error, setError] = useState(''),
    [saving, setSaving] = useState(false);
  const parents = [...new Map(inbound.map((r) => [JSON.stringify([r.po, r.line]), r])).entries()];
  async function submit() {
    if (!action) return;
    setSaving(true);
    setError('');
    try {
      await purchasingApi.action(action.draft._id, action.action, {
        version: action.draft.__v,
        note,
        ...(action.action === 'link' ? { poLines: selected } : {}),
      });
      setAction(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setSaving(false);
    }
  }
  async function exportDraft(draft: Draft) {
    setError('');
    try {
      const checked = await purchasingApi.checkedExport(draft._id);
      download(
        'approved-purchasing-draft.csv',
        csv([
          [
            'Draft',
            'Supplier',
            'Destination',
            'Variant',
            'Slabs',
            'Required receipt',
            'Status',
            'Buyer note',
          ],
          ...checked.lines.map((l) => [
            checked._id,
            l.supplier,
            l.branch,
            l.product,
            l.quantity,
            l.requiredOn,
            checked.status,
            checked.note,
          ]),
        ]),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    }
  }
  return (
    <div className="purchase-panel purchase-form">
      {error && !action && (
        <p role="alert" className="purchase-error">
          {error}
        </p>
      )}
      <h3>Container drafts</h3>
      <p className="purchase-muted">
        Approval is internal. Record the resulting SPS PO lines after the order appears in the incoming-supply
        import. Cancelled/ordered drafts release their variant reservations. Source changes require a fresh
        draft before approval or export.
      </p>
      {!drafts.length && <p>No purchasing drafts yet.</p>}
      {drafts.map((d) => (
        <article className="purchase-draft" key={d._id}>
          <header>
            <strong>
              {d.status.toUpperCase()} · {d._id.slice(-6)}
            </strong>
            <span>
              {new Date(d.createdAt).toLocaleString()} · {d.createdBy.name}
            </span>
          </header>
          <p>
            {d.lines.length} variants · {num(d.lines.reduce((n, l) => n + l.quantity, 0))} slabs ·{' '}
            {d.loads.length} container loads
          </p>
          {d.note && <p>{d.note}</p>}
          {d.loads.map((load, i) => (
            <details key={i}>
              <summary>
                Container {i + 1} · {load.supplier} → {load.branch} · {num(load.grossKg)} kg gross
              </summary>
              <ul>
                {load.lines.map((l) => (
                  <li key={l.key}>
                    {l.product}: {num(l.quantity)} slabs
                  </li>
                ))}
              </ul>
              <p>
                Required receipt: {load.requiredOn || 'Review with buyer'}. A required date is not a shipping
                promise.
              </p>
            </details>
          ))}
          <div className="purchase-actions">
            {canApprove && ['draft', 'approved'].includes(d.status) && (
              <>
                {d.status === 'draft' && (
                  <button
                    onClick={() => {
                      setAction({ draft: d, action: 'approve' });
                      setNote('');
                      setError('');
                    }}
                  >
                    Approve draft
                  </button>
                )}
                {d.status === 'approved' && (
                  <>
                    <button onClick={() => void exportDraft(d)}>Export approved draft</button>
                    <button
                      onClick={() => {
                        setAction({ draft: d, action: 'link' });
                        setSelected([]);
                        setNote('');
                        setError('');
                      }}
                    >
                      Link SPS order
                    </button>
                  </>
                )}
                <button
                  onClick={() => {
                    setAction({ draft: d, action: 'cancel' });
                    setNote('');
                    setError('');
                  }}
                >
                  Cancel draft
                </button>
              </>
            )}
          </div>
          {d.inputSnapshot && (
            <details>
              <summary>Calculation at draft creation</summary>
              <p>
                As of {d.inputSnapshot.today}. Stock: {d.inputSnapshot.stockImportedAt || 'missing'}. Incoming
                supply: {d.inputSnapshot.inboundImportedAt || 'missing'}.
              </p>
              <ul>
                {d.inputSnapshot.rows.map((row) => (
                  <li key={row.product}>
                    {row.product}: {num(row.protective.daily)} supplier slab equivalents/day; ready{' '}
                    {num(row.protective.ready)} + incoming {num(row.protective.inbound)}; target{' '}
                    {num(row.protective.target)}; calculated buy {num(row.protective.proposedSlabs)} slabs.
                    Buyer quantity and override note are retained separately.
                  </li>
                ))}
              </ul>
            </details>
          )}
          <details>
            <summary>Decision history</summary>
            <ul>
              {d.history.map((h, i) => (
                <li key={i}>
                  {h.action} · {h.name} · {new Date(h.at).toLocaleString()} · {h.note}
                </li>
              ))}
            </ul>
          </details>
        </article>
      ))}
      {action && (
        <FormModal
          title={`${action.action === 'link' ? 'Link SPS PO' : action.action} purchasing draft`}
          onClose={() => setAction(null)}
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          saving={saving}
          submitLabel="Confirm"
          dirtyCount={1}
        >
          <div className="purchase-form">
            {error && (
              <p role="alert" className="purchase-error">
                {error}
              </p>
            )}
            {action.action === 'link' && (
              <>
                <p>
                  Select imported PO lines that cover every draft variant and destination. Use new SPS PO
                  lines created for this draft; existing supply was already deducted from its need. Each PO
                  line can be linked to only one draft.
                </p>
                {parents.length ? (
                  parents.map(([key, row]) => (
                    <label className="purchase-check" key={key}>
                      <input
                        type="checkbox"
                        checked={selected.includes(key)}
                        onChange={(e) =>
                          setSelected((s) => (e.target.checked ? [...s, key] : s.filter((k) => k !== key)))
                        }
                      />
                      {row.po} / {row.line} · {row.product} · {row.branch} · {row.ordered - row.cancelled}{' '}
                      slabs
                    </label>
                  ))
                ) : (
                  <p>Import the placed order from SPS first.</p>
                )}
              </>
            )}
            <label>
              Decision note
              <textarea required maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          </div>
        </FormModal>
      )}
    </div>
  );
}
