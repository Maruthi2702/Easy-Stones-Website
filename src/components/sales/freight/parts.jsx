import React, { useEffect, useRef, useState } from 'react';
import { X, Flag, Copy, Check, Loader2 } from 'lucide-react';
import { STATUS_PILL, openFlagsOf, historyLabel } from '../../../utils/freightView';
import { FIELD_LABELS } from '../../../accounting/freightRules';
import { formatCents } from '../../../accounting/money';

const changeText = (c) => {
  const show = (v) => (c.field === 'amountCents' ? formatCents(v, { blank: 'no price' }) : (v === null || v === undefined || v === '' ? '—' : String(v)));
  return `${FIELD_LABELS[c.field] || c.field}: ${show(c.from)} → ${show(c.to)}`;
};

/** The status pill, a flag chip when it needs review, and "On invoice". */
export function StatusCell({ charge, showPaymentId = false }) {
  const pill = STATUS_PILL[charge.status] || { label: charge.status, tone: 'void' };
  const flags = openFlagsOf(charge);
  return (
    <div>
      <div className="fr-status">
        {flags.length > 0 ? (
          <span className="fr-flag" title={flags.map((f) => f.detail).join('; ')}>
            <Flag size={12} aria-hidden="true" />Needs review
          </span>
        ) : null}
        <span className={`fr-pill ${pill.tone}`}>{pill.label}</span>
        {charge.invoiceId && charge.status !== 'paid' ? <span className="fr-terms invoice">On invoice</span> : null}
      </div>
      {showPaymentId && charge.payment?.paymentId ? <span className="fr-pid fr-mono">{charge.payment.paymentId}</span> : null}
    </div>
  );
}

/**
 * A side panel (charge, invoice, payment, carriers) over the page, with a
 * scrim. Esc and the scrim close it — unless a form (FormModal) is open on
 * top, which handles Esc itself.
 */
export function Drawer({ label, kicker, onClose, children, footer, wide = false }) {
  const panelRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('.fm-overlay, .fm-confirm')) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => { panelRef.current?.focus({ preventScroll: true }); }, []);
  return (
    <>
      <div className="fr-scrim" onClick={onClose} aria-hidden="true" />
      <aside ref={panelRef} tabIndex={-1} className={`fr-drawer${wide ? ' wide' : ''}`} aria-label={label}>
        <div className="fr-drawer-top">
          <span className="fr-grow">{kicker}</span>
          <button type="button" className="fr-close" onClick={onClose} aria-label="Close" title="Close">
            <X size={18} strokeWidth={2.4} aria-hidden="true" />
          </button>
        </div>
        <div className="fr-drawer-body">{children}</div>
        {footer ? <div className="fr-drawer-foot">{footer}</div> : null}
      </aside>
    </>
  );
}

export function Loading() {
  return <div className="fr-loading"><Loader2 size={28} className="fr-spin" aria-label="Loading" /></div>;
}

export function CopyButton({ value, label }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return undefined;
    const t = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <button
      type="button"
      className="fr-icon-btn"
      style={{ width: 36, height: 36 }}
      aria-label={done ? 'Copied' : label}
      title={done ? 'Copied' : label}
      onClick={async () => {
        try { await navigator.clipboard.writeText(value); setDone(true); } catch { /* clipboard blocked — nothing to do */ }
      }}
    >
      {done ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
    </button>
  );
}

const when = (at) => {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

/** The history lines, newest first, each with its own TX- id. */
export function HistoryList({ entries = [] }) {
  if (!entries.length) return <p style={{ margin: 0, color: 'var(--fr-muted)' }}>Nothing yet.</p>;
  return (
    <div>
      {entries.map((e) => (
        <div className="fr-ev" key={e.txnId || e._id}>
          <span className={`fr-ev-dot ${e.action === 'paid' ? 'paid' : e.action === 'approved' ? 'approved' : e.action === 'flagged' ? 'flagged' : ''}`} aria-hidden="true" />
          <div>
            <b>{historyLabel(e.action)}</b>
            <span className="fr-ev-meta"> · {e.by?.name || 'Delivery Schedule'} · {when(e.at)}</span>
            {e.note ? <div className="fr-ev-meta">{e.note}</div> : null}
            {e.action !== 'created' && (e.changes || []).filter((c) => c.field !== 'status').length > 0 ? (
              <div className="fr-ev-meta">
                {e.changes.filter((c) => c.field !== 'status').map(changeText).join('; ')}
              </div>
            ) : null}
            {e.txnId ? <span className="fr-tx fr-mono">{e.txnId}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
