import type { ReactElement } from 'react';
import { AlertTriangle, Receipt, Pencil, Check } from 'lucide-react';
import { Drawer } from '../parts/Drawer';
import { Loading } from '../parts/Loading';
import { StatusCell } from '../parts/StatusCell';
import { HistoryList } from '../parts/HistoryList';
import { FREIGHT } from '../../../accounting/permissions';
import { formatCents } from '../../../accounting/money';
import { has, selectionActions, shortDate, STATUS_PILL } from '../freightView';
import { getCharge } from '../freightApi';
import { useLoad } from './useLoad';
import { FlagNotes, PaymentBox } from './panelParts';
import { dateTime, termsText } from './panelText';
import type { PanelProps } from './panelParts';

/** One charge: what it is, its review flags, payment, history and actions. */
export function ChargePanel({ id, user, reloadKey, onClose, act }: PanelProps) {
  const { data: c, error } = useLoad(() => getCharge(id), [id, reloadKey]);
  let footer: ReactElement[] | null = null;
  if (c) {
    const sel = selectionActions([c], user);
    const btns: ReactElement[] = [];
    if (c.invoiceId) btns.push(<button key="inv" type="button" className="fr-btn" onClick={() => act.openInvoice(String(c.invoiceId))}><Receipt size={16} aria-hidden="true" />Open invoice{c.invoice?.invoiceNumber ? ` #${c.invoice.invoiceNumber}` : ''}</button>);
    if (c.status === 'draft' && has(user, FREIGHT.EDIT)) btns.push(<button key="edit" type="button" className="fr-btn" onClick={() => act.edit(c)}><Pencil size={16} aria-hidden="true" />Edit</button>);
    if (sel.sendBack) btns.push(<button key="back" type="button" className="fr-btn" onClick={() => act.sendBack([c])}>Send back</button>);
    if (sel.approve) btns.push(<button key="ok" type="button" className="fr-btn" onClick={() => act.approve([c])}><Check size={16} aria-hidden="true" />Approve</button>);
    if (sel.pay) btns.push(<button key="pay" type="button" className="fr-btn gold" onClick={() => act.pay([c])}>{sel.pay}</button>);
    if (c.status !== 'paid' && c.status !== 'void' && !c.invoiceId && has(user, FREIGHT.VOID)) btns.push(<button key="void" type="button" className="fr-btn danger" onClick={() => act.voidCharge(c)}>Void</button>);
    footer = btns.length ? btns : null;
  }
  return (
    <Drawer label={c ? `Charge SO# ${c.soNumber || ''}` : 'Charge'} kicker="Freight charge" onClose={onClose} footer={footer}>
      {error ? <div className="fr-note error" role="alert"><AlertTriangle size={18} aria-hidden="true" /><span>{error}</span></div> : null}
      {!c && !error ? <Loading /> : null}
      {c ? (
        <>
          <div className="fr-dh">
            <div className="fr-grow" style={{ minWidth: 0 }}>
              <div className="fr-dh-kicker">{c.carrier ? `${c.carrier.name} · ${termsText(c.carrier)}` : c.carrierNameRaw ? `“${c.carrierNameRaw}” · carrier not matched yet` : 'No carrier yet'}</div>
              <h2 className="fr-dh-title">SO# {c.soNumber || '—'} · {c.amountCents > 0 ? formatCents(c.amountCents) : <span className="fr-miss">No price</span>}</h2>
              <div className="fr-dh-sub">{[c.customerName, c.location, shortDate(c.deliveryDate)].filter(Boolean).join(' · ')}</div>
            </div>
            <StatusCell charge={{ ...c, openFlags: [] }} />
          </div>
          <FlagNotes record={c} canReview={has(user, FREIGHT.EDIT)} onReview={() => act.review(c)} />
          {c.status === 'void' ? <div className="fr-note warn"><span><b>Voided</b>{c.voidReason ? ` — ${c.voidReason}` : ''}{c.voidedBy?.name ? ` · ${c.voidedBy.name}` : ''}</span></div> : null}
          <PaymentBox payment={c.payment} onOpen={act.openPayment} />
          <section className="fr-sec" aria-label="Charge">
            <h3>Charge</h3>
            <dl className="fr-kv">
              <dt>Carrier</dt><dd>{c.carrier?.name || '—'}</dd>
              {c.carrierNameRaw ? <><dt>Typed on delivery</dt><dd>{c.carrierNameRaw}</dd></> : null}
              <dt>BOL #</dt><dd>{c.bolNumber || '—'}</dd>
              <dt>Amount</dt><dd>{formatCents(c.amountCents, { blank: 'No price yet' })}</dd>
              {c.description ? <><dt>For</dt><dd>{c.description}</dd></> : null}
              {c.invoice ? <><dt>Invoice</dt><dd>#{c.invoice.invoiceNumber} ({STATUS_PILL[c.invoice.status]?.label.toLowerCase()})</dd></> : null}
              {c.approvedAt ? <><dt>Approved</dt><dd>{dateTime(c.approvedAt)}{c.approvedBy?.name ? ` by ${c.approvedBy.name}` : ''}</dd></> : null}
              <dt>From</dt><dd>{c.source === 'manual' ? 'Added by hand' : 'The Delivery Schedule'}</dd>
              {c.notes ? <><dt>Notes</dt><dd>{c.notes}</dd></> : null}
            </dl>
          </section>
          {c.history ? (
            <section className="fr-sec" aria-label="History">
              <h3>History</h3>
              <HistoryList entries={c.history} />
            </section>
          ) : null}
        </>
      ) : null}
    </Drawer>
  );
}
