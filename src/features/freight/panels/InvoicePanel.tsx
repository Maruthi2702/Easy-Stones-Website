import type { ReactElement } from 'react';
import { AlertTriangle, Pencil, Check } from 'lucide-react';
import { Drawer } from '../parts/Drawer';
import { Loading } from '../parts/Loading';
import { StatusCell } from '../parts/StatusCell';
import { HistoryList } from '../parts/HistoryList';
import { FREIGHT } from '../../../accounting/permissions';
import { formatCents, sumCents } from '../../../accounting/money';
import { has, openFlagsOf, shortDate } from '../freightView';
import { getInvoice } from '../freightApi';
import { useLoad } from './useLoad';
import { PaymentBox } from './panelParts';
import type { PanelProps } from './panelParts';
import type { Loose } from '../../../types/records';

/** A carrier invoice and every charge on it. */
export function InvoicePanel({ id, user, reloadKey, onClose, act }: PanelProps) {
  const { data: inv, error } = useLoad(() => getInvoice(id), [id, reloadKey]);
  let footer: ReactElement[] | null = null;
  if (inv) {
    const canApprove = has(user, FREIGHT.APPROVE);
    const canPay = has(user, FREIGHT.PAY);
    const btns: ReactElement[] = [];
    if (inv.status === 'draft' && has(user, FREIGHT.EDIT)) btns.push(<button key="edit" type="button" className="fr-btn" onClick={() => act.editInvoice(inv)}><Pencil size={16} aria-hidden="true" />Edit</button>);
    if (inv.status === 'approved' && canApprove) btns.push(<button key="back" type="button" className="fr-btn" onClick={() => act.invoiceStep(inv, 'unapprove')}>Send back</button>);
    if (inv.status === 'draft' && canApprove) btns.push(<button key="ok" type="button" className="fr-btn" onClick={() => act.invoiceStep(inv, 'approve')}><Check size={16} aria-hidden="true" />Approve</button>);
    if (canPay && (inv.status === 'approved' || (inv.status === 'draft' && canApprove))) {
      btns.push(<button key="pay" type="button" className="fr-btn gold" onClick={() => act.payInvoice(inv)}>{inv.status === 'draft' ? 'Approve & pay' : 'Mark paid'}</button>);
    }
    if ((inv.status === 'draft' || inv.status === 'approved') && has(user, FREIGHT.VOID)) btns.push(<button key="void" type="button" className="fr-btn danger" onClick={() => act.voidInvoice(inv)}>Void</button>);
    footer = btns.length ? btns : null;
  }
  const charges: Loose[] = inv?.charges || [];
  const sum = sumCents(charges.map((c) => c.amountCents));
  return (
    <Drawer label={inv ? `Invoice ${inv.invoiceNumber}` : 'Invoice'} kicker="Carrier invoice" onClose={onClose} footer={footer}>
      {error ? <div className="fr-note error" role="alert"><AlertTriangle size={18} aria-hidden="true" /><span>{error}</span></div> : null}
      {!inv && !error ? <Loading /> : null}
      {inv ? (
        <>
          <div className="fr-dh">
            <div className="fr-grow" style={{ minWidth: 0 }}>
              <div className="fr-dh-kicker">{inv.carrier?.name || 'Carrier'} · {charges.length} charge{charges.length === 1 ? '' : 's'}</div>
              <h2 className="fr-dh-title">#{inv.invoiceNumber} · {formatCents(inv.totalCents)}</h2>
              <div className="fr-dh-sub">Invoice date {shortDate(inv.invoiceDate)}</div>
            </div>
            <StatusCell charge={inv} />
          </div>
          {inv.status === 'draft' ? (sum === inv.totalCents
            ? <div className="fr-note info"><Check size={18} aria-hidden="true" /><span><b>Matches.</b> Charges {formatCents(sum)} · invoice total {formatCents(inv.totalCents)}</span></div>
            : <div className="fr-note warn"><AlertTriangle size={18} aria-hidden="true" /><span><b>Charges {formatCents(sum)} · invoice {formatCents(inv.totalCents)}.</b> It can’t be approved until they match.</span></div>)
            : null}
          {inv.status === 'void' ? <div className="fr-note warn"><span><b>Voided</b>{inv.voidReason ? ` — ${inv.voidReason}` : ''}</span></div> : null}
          <PaymentBox payment={inv.payment} onOpen={act.openPayment} />
          <section className="fr-sec" aria-label="Charges on this invoice">
            <h3>Charges</h3>
            {charges.map((c) => (
              <div className="fr-crow" key={c._id}>
                <button type="button" onClick={() => act.openCharge(String(c._id))}><b>SO# {c.soNumber || '—'}</b> · {c.customerName || 'No customer'}</button>
                <b>{formatCents(c.amountCents, { blank: 'No price' })}</b>
                <span className="fr-crow-sub">{shortDate(c.deliveryDate)}{c.bolNumber ? ` · ${c.bolNumber}` : ''}{openFlagsOf(c).length ? ' · needs review' : ''}</span>
              </div>
            ))}
          </section>
          {inv.history ? <section className="fr-sec" aria-label="History"><h3>History</h3><HistoryList entries={inv.history} /></section> : null}
        </>
      ) : null}
    </Drawer>
  );
}
