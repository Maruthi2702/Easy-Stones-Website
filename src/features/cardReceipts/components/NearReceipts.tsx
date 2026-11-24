import { useEffect, useState } from 'react';
import { FormSection } from '../../../components/shared/form/FormControls';
import { formatMoney, statusOf, usDate } from '../../../utils/cardReceipts';
import type { NearReceipt, NearReceipts as NearList } from '../cardReceiptsApi';
import type { Expense } from '../types';

export type NearReceiptsProps = {
  /** The Missing receipt row opened (the cardholder's own). */
  missing: Expense;
  load: (missingId: string) => Promise<NearList>;
  onUse: (receiptId: string) => Promise<unknown>;
};

/** What picking this receipt changes, in words (the server does it: matchReceiptToCharge in db/cardStatements). */
export function nearEffectLine(r: NearReceipt, charge: { cents: number; date: string }) {
  const parts: string[] = [];
  if (r.cents !== charge.cents) parts.push(`total becomes ${formatMoney(charge.cents)}`);
  if (r.date !== charge.date) parts.push(`date becomes ${usDate(charge.date)}`);
  const again = r.cents !== charge.cents && r.status === 'approved';
  return `${parts.length ? `Its ${parts.join(' and its ')}` : 'It answers this charge'}${again ? ', and it goes back for approval' : ''}. This Missing receipt goes away.`;
}

/**
 * Review B2 (2026-11-24): on a Missing receipt row, the cardholder's own receipts close to the charge
 * (amount within $5 / 10%, a week either side). The automatic match is exact, so a tip changed after the
 * receipt or a mistyped total left the charge "missing" and the same purchase was uploaded twice. Picking
 * "This is my receipt" links the charge to it instead. Shows nothing when there are none.
 */
export default function NearReceipts({ missing, load, onUse }: NearReceiptsProps) {
  const [list, setList] = useState<NearList | null>(null);
  const [picked, setPicked] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    setList(null); setPicked(''); setError('');
    load(missing.id).then((r) => { if (live) setList(r); }).catch(() => { /* nothing offered; Add receipt still works */ });
    return () => { live = false; };
  }, [missing.id, load]);

  const charge = list?.charge;
  if (!charge || !list?.receipts.length) return null;

  const use = async (id: string) => {
    setBusy(true);
    setError('');
    try { await onUse(id); } catch (err) { setError((err as Error).message); setBusy(false); }
  };

  return (
    <FormSection>
      <div className="ccr-near" role="group" aria-labelledby="ccr-near-h">
        <h3 className="ccr-todo-h" id="ccr-near-h">Already uploaded this one?</h3>
        <span className="ccr-sub">
          The bank charged {formatMoney(charge.cents)} on {usDate(charge.date)}. If one of these is the same purchase, use it — don’t upload it again.
        </span>
        {error ? <div className="ccr-form-error" role="alert">{error}</div> : null}
        {list.receipts.map((r) => (
          <div key={r.id} className="ccr-near-row">
            <b>{r.merchant} · {formatMoney(r.cents)}</b>
            {picked === r.id ? (
              <span className="ccr-near-act">
                <button type="button" className="ccr-btn gold" disabled={busy} onClick={() => use(r.id)}>{busy ? 'Saving…' : 'Yes, use it'}</button>
                <button type="button" className="ccr-btn" disabled={busy} onClick={() => setPicked('')}>Cancel</button>
              </span>
            ) : (
              <button type="button" className="ccr-btn" disabled={busy} onClick={() => setPicked(r.id)}>This is my receipt</button>
            )}
            <span className="ccr-sub">
              {picked === r.id ? nearEffectLine(r, charge) : `${usDate(r.date)} · ${statusOf(r.status)?.label || r.status}${r.cardLabel ? ` · ${r.cardLabel}` : ''}`}
            </span>
          </div>
        ))}
      </div>
    </FormSection>
  );
}
