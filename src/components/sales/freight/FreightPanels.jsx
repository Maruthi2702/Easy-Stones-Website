import React, { useEffect, useState } from 'react';
import { Flag, AlertTriangle, Receipt, Plus, Pencil, Check } from 'lucide-react';
import { Drawer, StatusCell, Loading, CopyButton, HistoryList } from './parts';
import { FREIGHT, CARRIERS } from '../../../accounting/permissions';
import { PAYMENT_TERMS } from '../../../accounting/freightRules';
import { formatCents, sumCents } from '../../../accounting/money';
import { openFlagsOf, selectionActions, shortDate, paymentMethodText, STATUS_PILL } from '../../../utils/freightView';
import { getCharge, getInvoice, getPayment, listCarriers, listCharges } from '../../../api/freight';

const has = (user, perm) => Array.isArray(user?.permissions) && user.permissions.includes(perm);
const termsText = (carrier) => (carrier?.paymentTerms === PAYMENT_TERMS.PER_INVOICE ? 'paid per invoice' : 'paid per delivery');
const dateTime = (at) => (at ? new Date(at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

/** Load something for a panel, again whenever `reloadKey` moves on. */
function useLoad(loader, deps) {
  const [state, setState] = useState({ data: null, error: '' });
  useEffect(() => {
    let live = true;
    setState((s) => ({ data: s.data, error: '' }));
    loader().then((data) => live && setState({ data, error: '' })).catch((err) => live && setState({ data: null, error: err.message }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

function FlagNotes({ record, canReview, onReview }) {
  const flags = openFlagsOf(record);
  if (!flags.length) return null;
  return (
    <div className="fr-note flag" role="alert">
      <Flag size={18} aria-hidden="true" />
      <div className="fr-grow">
        <b>{record.status === 'draft' ? 'Needs review' : `Delivery changed after it was ${STATUS_PILL[record.status]?.label.toLowerCase()}`}</b>
        {flags.map((f) => <div key={f._id}>{f.detail}</div>)}
        <div style={{ marginTop: 4, fontSize: 13 }}>It can’t be approved or paid until someone marks it reviewed (or voids it).</div>
      </div>
      {canReview ? <button type="button" className="fr-btn sm" onClick={onReview}>Mark reviewed</button> : null}
    </div>
  );
}

function PaymentBox({ payment, onOpen }) {
  if (!payment?.paymentId) return null;
  return (
    <section className="fr-sec" aria-label="Payment">
      <h3>Payment</h3>
      <div className="fr-idline" style={{ marginTop: 0, marginBottom: 10 }}>
        <button type="button" className="fr-link fr-mono" onClick={() => onOpen(payment.paymentId)}>{payment.paymentId}</button>
        <CopyButton value={payment.paymentId} label="Copy payment ID" />
      </div>
      <dl className="fr-kv">
        <dt>Paid on</dt><dd>{shortDate(payment.paidOn)}</dd>
        <dt>Method</dt><dd>{paymentMethodText(payment)}</dd>
        <dt>Recorded</dt><dd>{dateTime(payment.recordedAt)}{payment.recordedBy?.name ? ` by ${payment.recordedBy.name}` : ''}</dd>
      </dl>
    </section>
  );
}

/** One charge: what it is, its review flags, payment, history and actions. */
export function ChargePanel({ id, user, reloadKey, onClose, act }) {
  const { data: c, error } = useLoad(() => getCharge(id), [id, reloadKey]);
  let footer = null;
  if (c) {
    const sel = selectionActions([c], user);
    const btns = [];
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

/** A carrier invoice and every charge on it. */
export function InvoicePanel({ id, user, reloadKey, onClose, act }) {
  const { data: inv, error } = useLoad(() => getInvoice(id), [id, reloadKey]);
  let footer = null;
  if (inv) {
    const canApprove = has(user, FREIGHT.APPROVE);
    const canPay = has(user, FREIGHT.PAY);
    const btns = [];
    if (inv.status === 'draft' && has(user, FREIGHT.EDIT)) btns.push(<button key="edit" type="button" className="fr-btn" onClick={() => act.editInvoice(inv)}><Pencil size={16} aria-hidden="true" />Edit</button>);
    if (inv.status === 'approved' && canApprove) btns.push(<button key="back" type="button" className="fr-btn" onClick={() => act.invoiceStep(inv, 'unapprove')}>Send back</button>);
    if (inv.status === 'draft' && canApprove) btns.push(<button key="ok" type="button" className="fr-btn" onClick={() => act.invoiceStep(inv, 'approve')}><Check size={16} aria-hidden="true" />Approve</button>);
    if (canPay && (inv.status === 'approved' || (inv.status === 'draft' && canApprove))) {
      btns.push(<button key="pay" type="button" className="fr-btn gold" onClick={() => act.payInvoice(inv)}>{inv.status === 'draft' ? 'Approve & pay' : 'Mark paid'}</button>);
    }
    if ((inv.status === 'draft' || inv.status === 'approved') && has(user, FREIGHT.VOID)) btns.push(<button key="void" type="button" className="fr-btn danger" onClick={() => act.voidInvoice(inv)}>Void</button>);
    footer = btns.length ? btns : null;
  }
  const charges = inv?.charges || [];
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

/** A payment: the PAY- id, how it was paid, and every charge it covered. */
export function PaymentPanel({ paymentId, onClose, act }) {
  const { data: p, error } = useLoad(() => getPayment(paymentId), [paymentId]);
  return (
    <Drawer label={`Payment ${paymentId}`} kicker="Payment" onClose={onClose}>
      {error ? <div className="fr-note error" role="alert"><AlertTriangle size={18} aria-hidden="true" /><span>{error}</span></div> : null}
      {!p && !error ? <Loading /> : null}
      {p ? (
        <>
          <div className="fr-dh">
            <div className="fr-grow" style={{ minWidth: 0 }}>
              <div className="fr-dh-kicker">{p.carrier?.name || 'Carrier'} · {p.charges.length} charge{p.charges.length === 1 ? '' : 's'}{p.invoice ? ` · invoice #${p.invoice.invoiceNumber}` : ''}</div>
              <h2 className="fr-dh-title">{formatCents(p.totalCents)}</h2>
              <div className="fr-idline">
                <span className="fr-mono">{p.paymentId}</span>
                <CopyButton value={p.paymentId} label="Copy payment ID" />
              </div>
            </div>
            <span className="fr-pill paid">Paid</span>
          </div>
          <section className="fr-sec" aria-label="Payment details">
            <h3>Payment</h3>
            <dl className="fr-kv">
              <dt>Paid on</dt><dd>{shortDate(p.paidOn)}</dd>
              <dt>Method</dt><dd>{paymentMethodText(p)}</dd>
              <dt>Recorded</dt><dd>{dateTime(p.recordedAt)}{p.recordedBy?.name ? ` by ${p.recordedBy.name}` : ''}</dd>
              <dt>Approval</dt><dd>{p.approvedInSameStep ? 'Approved and paid in one step' : 'Approved before payment'}</dd>
            </dl>
          </section>
          <section className="fr-sec" aria-label="Charges this paid">
            <h3>Charges this paid</h3>
            {p.charges.map((c) => (
              <div className="fr-crow" key={c._id}>
                <button type="button" onClick={() => act.openCharge(String(c._id))}><b>SO# {c.soNumber || '—'}</b> · {c.customerName || 'No customer'}</button>
                <b>{formatCents(c.amountCents)}</b>
                <span className="fr-crow-sub">{shortDate(c.deliveryDate)}{c.bolNumber ? ` · ${c.bolNumber}` : ''} · {c.location}</span>
              </div>
            ))}
          </section>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--fr-muted)' }}>Search this payment ID or the reference on 3rd-Party Freight to find these charges again. Each history line has its own TX- ID.</p>
        </>
      ) : null}
    </Drawer>
  );
}

/** The carrier list (More › Carriers), with any typed carrier nobody recognises. */
export function CarriersPanel({ user, reloadKey, onClose, act }) {
  const { data, error } = useLoad(async () => {
    const [carriers, waiting] = await Promise.all([listCarriers(), listCharges({ status: 'to_approve', limit: 100 }).catch(() => ({ items: [] }))]);
    const unmatched = [...new Set(waiting.items.filter((c) => !c.carrier && c.carrierNameRaw).map((c) => c.carrierNameRaw.trim()))];
    return { carriers, unmatched };
  }, [reloadKey]);
  const canAdd = has(user, CARRIERS.ADD);
  const canEdit = has(user, CARRIERS.EDIT);
  return (
    <Drawer label="Carriers" kicker="Carriers" onClose={onClose}
      footer={canAdd ? <button type="button" className="fr-btn gold" onClick={() => act.carrierForm(null)}><Plus size={16} aria-hidden="true" />Add carrier</button> : null}>
      {error ? <div className="fr-note error" role="alert"><AlertTriangle size={18} aria-hidden="true" /><span>{error}</span></div> : null}
      {!data && !error ? <Loading /> : null}
      {data ? (
        <>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--fr-muted)' }}>A carrier typed on a delivery is matched by its name or any other spelling listed here.</p>
          {data.unmatched.length ? (
            <div className="fr-note warn" role="status">
              <AlertTriangle size={18} aria-hidden="true" />
              <div className="fr-grow">
                <b>{data.unmatched.length} carrier name{data.unmatched.length > 1 ? 's' : ''} nobody recognises:</b>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {data.unmatched.map((n) => (
                    canAdd
                      ? <button key={n} type="button" className="fr-btn sm" onClick={() => act.carrierForm(null, n)}><Plus size={14} aria-hidden="true" />{n}</button>
                      : <span key={n} className="fr-alias">{n}</span>
                  ))}
                </div>
                <div style={{ fontSize: 13, marginTop: 6 }}>Add it as a carrier, or add the spelling to an existing one.</div>
              </div>
            </div>
          ) : null}
          <div className="fr-carriers">
            {data.carriers.length === 0 ? <div className="fr-empty"><h3>No carriers yet</h3>Add the contract carriers your branches use.</div> : null}
            {data.carriers.map((c) => (
              <div key={c._id} className={`fr-carrier${c.active === false ? ' inactive' : ''}`}>
                <div className="fr-carrier-main">
                  <span className="fr-carrier-name">{c.name}
                    <span className={`fr-terms${c.paymentTerms === PAYMENT_TERMS.PER_INVOICE ? ' invoice' : ''}`}>{c.paymentTerms === PAYMENT_TERMS.PER_INVOICE ? 'Per invoice' : 'Per delivery'}</span>
                    {c.active === false ? <span className="fr-sub">Deactivated</span> : null}
                  </span>
                  {c.aliases?.length ? <div>{c.aliases.map((a) => <span key={a} className="fr-alias">{a}</span>)}</div> : null}
                </div>
                {canEdit ? (
                  <button type="button" className="fr-icon-btn" aria-label={`Edit ${c.name}`} title="Edit" onClick={() => act.carrierForm(c)}>
                    <Pencil size={15} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </Drawer>
  );
}
