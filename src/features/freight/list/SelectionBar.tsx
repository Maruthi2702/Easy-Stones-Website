import { formatCents } from '../../../accounting/money';
import type { selectionActions } from '../freightView';

/**
 * The bar at the foot of the page while charges are ticked: how many and
 * their total, Clear, and what selectionActions allows — Send back, Approve,
 * Approve & pay / Mark paid — or why paying isn't offered.
 */
export default function SelectionBar({ bar, busy, onClear, onSendBack, onApprove, onPay }: {
  bar: ReturnType<typeof selectionActions>; busy: boolean;
  onClear: () => void; onSendBack: () => void; onApprove: () => void; onPay: () => void;
}) {
  return (
    <div className="fr-bar" role="region" aria-label="Selected charges">
      <span className="fr-bar-sum">{bar.count}<span className="fr-bar-word"> selected</span> · {formatCents(bar.cents)}</span>
      <button type="button" className="fr-btn ghost fr-bar-clear" onClick={onClear}>Clear</button>
      {!bar.pay && bar.payBlocked ? <span className="fr-bar-note">{bar.payBlocked}</span> : null}
      {bar.sendBack || bar.approve || bar.pay ? (
        <span className="fr-bar-actions">
          {bar.sendBack ? <button type="button" className="fr-btn dark" disabled={busy} onClick={onSendBack}>Send back</button> : null}
          {bar.approve ? <button type="button" className="fr-btn dark" disabled={busy} onClick={onApprove}>Approve</button> : null}
          {bar.pay ? <button type="button" className="fr-btn gold" disabled={busy} onClick={onPay}>{bar.pay}</button> : null}
        </span>
      ) : null}
    </div>
  );
}
