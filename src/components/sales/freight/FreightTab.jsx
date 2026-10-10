import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, Plus, MoreHorizontal, Truck, Download, CheckCircle2, AlertTriangle, Receipt } from 'lucide-react';
import LocationFilter, { LocationField } from '../../shared/LocationFilter';
import { useLocationFilter } from '../../shared/useLocationFilter';
import Pagination from '../../shared/Pagination';
import { usePagination } from '../../shared/paginationConfig';
import { accessibleLocations, homeLocationOf, locationNames } from '../../../utils/locationFilter';
import { FREIGHT, CARRIERS } from '../../../accounting/permissions';
import { formatCents } from '../../../accounting/money';
import {
  FREIGHT_TABS, tabCount, groupByCarrier, selectionActions, shortDate, todayIso, freightExportRows, openFlagsOf
} from '../../../utils/freightView';
import * as api from '../../../api/freight';
import { StatusCell, Loading } from './parts';
import { ChargePanel, InvoicePanel, PaymentPanel, CarriersPanel } from './FreightPanels';
import { PayForm, VoidForm, ChargeForm, CarrierForm } from './FreightForms';
import InvoiceForm from './InvoiceForm';
import './Freight.css';

const has = (user, perm) => Array.isArray(user?.permissions) && user.permissions.includes(perm);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const EMPTY = {
  to_approve: ['Nothing waiting', 'Every charge is approved or paid. New ones appear here when a 3rd-party delivery is completed.'],
  approved: ['Nothing approved and unpaid', 'Approved charges wait here until they’re marked paid.'],
  paid: ['No payments yet', 'Paid charges show here, each with its payment ID.'],
  all: ['No charges', 'Charges appear when a 3rd-party delivery is completed, or when one is added by hand.']
};

/**
 * Accounting · 3rd-Party Freight: what we owe contract carriers for completed
 * 3rd-party deliveries, approved and paid here. Built from the "Accounting ·
 * 3rd-Party Freight" canvas; rules in src/utils/freightView.js and
 * src/accounting/. The server checks every permission and branch again.
 */
export default function FreightTab({ currentUser, locationsList = [], sidebarToggle = null }) {
  const user = currentUser;
  const [tab, setTab] = useState('to_approve');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const branchOptions = useMemo(() => accessibleLocations(user, locationsList), [user, locationsList]);
  const [location, setLocation] = useLocationFilter('freight', user, branchOptions);
  const [carrierId, setCarrierId] = useState('');
  const { currentPage, setCurrentPage, rowsPerPage, setRowsPerPage, resetPage } = usePagination();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [carriers, setCarriers] = useState([]);
  const [selected, setSelected] = useState(() => new Map());
  const [panel, setPanel] = useState(null); // { type: 'charge'|'invoice'|'payment'|'carriers', id }
  const [form, setForm] = useState(null);
  const [toast, setToast] = useState(null); // { text, paymentId }
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const menuRef = useRef(null);
  const seq = useRef(0);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  // Typing settles before it reaches the server.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // A new view: back to page 1, nothing selected.
  const filterKey = `${tab}|${debounced}|${location}|${carrierId}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setSelected(new Map());
    resetPage();
  }

  useEffect(() => {
    const n = ++seq.current;
    setLoading(true);
    api.listCharges({ status: tab, search: debounced, location, carrierId, page: currentPage, limit: rowsPerPage })
      .then((r) => { if (n === seq.current) { setData(r); setError(''); } })
      .catch((err) => { if (n === seq.current) setError(err.message); })
      .finally(() => { if (n === seq.current) setLoading(false); });
  }, [tab, debounced, location, carrierId, currentPage, rowsPerPage, reloadKey]);

  useEffect(() => {
    api.listCarriers().then(setCarriers).catch(() => {});
  }, [reloadKey]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), toast.paymentId ? 12000 : 6000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (e) => { if (!menuRef.current?.contains(e.target)) setMenuOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

  const items = useMemo(() => data?.items || [], [data]);
  const summary = data?.summary || {};
  const groups = useMemo(() => groupByCarrier(items), [items]);
  const selectedList = [...selected.values()];
  const bar = selectionActions(selectedList, user);

  // ── Actions (the server checks each one again) ──
  const run = async (fn, message) => {
    setBusy(true);
    setError('');
    try {
      const r = await fn();
      setSelected(new Map());
      refresh();
      if (message) {
        const m = typeof message === 'function' ? message(r) : message;
        setToast(typeof m === 'string' ? { text: m } : m);
      }
      return r;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const paidToast = (r, what) => ({
    text: `${r.replayed ? 'Already paid — ' : 'Paid '}${what} · ${formatCents(r.payment?.totalCents ?? r.totalCents)}`,
    paymentId: r.payment?.paymentId
  });

  const act = {
    approve: (cs) => run(() => api.approveCharges(cs), { text: `Approved ${plural(cs.length, 'charge')}` }),
    sendBack: (cs) => run(() => api.sendBackCharges(cs), { text: `Sent ${plural(cs.length, 'charge')} back to approval` }),
    review: (c) => run(() => api.markReviewed(c), { text: 'Marked reviewed' }),
    pay: (cs) => setForm({ type: 'pay', charges: cs }),
    voidCharge: (c) => setForm({ type: 'void', charge: c }),
    edit: (c) => setForm({ type: 'charge', charge: c }),
    openCharge: (id) => setPanel({ type: 'charge', id }),
    openInvoice: (id) => setPanel({ type: 'invoice', id }),
    openPayment: (id) => setPanel({ type: 'payment', id }),
    editInvoice: (invoice) => setForm({ type: 'invoice', invoice }),
    newInvoice: (carrier) => setForm({ type: 'invoice', invoice: null, carrierId: carrier ? String(carrier._id) : '' }),
    invoiceStep: (inv, step) => run(() => api.invoiceStep(inv, step), { text: step === 'approve' ? `Approved invoice #${inv.invoiceNumber}` : `Invoice #${inv.invoiceNumber} sent back to approval` }),
    payInvoice: (invoice) => setForm({ type: 'payInvoice', invoice }),
    voidInvoice: (invoice) => setForm({ type: 'voidInvoice', invoice }),
    carrierForm: (carrier, name = '') => setForm({ type: 'carrier', carrier, name })
  };

  const closeForm = () => setForm(null);
  const done = (message) => { setForm(null); setSelected(new Map()); refresh(); if (message) setToast(message); };

  const toggle = (c) => setSelected((m) => {
    const next = new Map(m);
    if (next.has(c._id)) next.delete(c._id); else next.set(c._id, c);
    return next;
  });
  const selectable = (c) => c.status === 'draft' || c.status === 'approved';
  const toggleGroup = (g) => setSelected((m) => {
    const next = new Map(m);
    const rows = g.items.filter(selectable);
    const allOn = rows.length > 0 && rows.every((c) => next.has(c._id));
    for (const c of rows) { if (allOn) next.delete(c._id); else next.set(c._id, c); }
    return next;
  });
  const groupState = (g) => {
    const rows = g.items.filter(selectable);
    const on = rows.filter((c) => selected.has(c._id)).length;
    return { all: rows.length > 0 && on === rows.length, some: on > 0 && on < rows.length, none: rows.length === 0 };
  };

  const exportExcel = async () => {
    setMenuOpen(false);
    setExporting(true);
    try {
      const r = await api.exportCharges({ status: tab, search: debounced, location, carrierId });
      const XLSX = await import('xlsx');
      const ws = XLSX.utils.json_to_sheet(freightExportRows(r.items));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '3rd-Party Freight');
      XLSX.writeFile(wb, `freight-${tab.replace('_', '-')}${location ? `-${location.replace(/\s+/g, '_')}` : ''}-${todayIso()}.xlsx`);
      if (r.truncated) setToast({ text: `Exported the first ${r.items.length.toLocaleString()} of ${r.total.toLocaleString()} — pick a branch or carrier for the rest.` });
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  };

  const filterActive = Boolean(location) || Boolean(carrierId);
  const canAdd = has(user, FREIGHT.ADD);
  const carrierName = (id) => carriers.find((c) => String(c._id) === String(id))?.name || 'Carrier';
  const showBranch = !location;

  const rowCheckbox = (c, extra = {}) => (
    <input type="checkbox" className="fr-chk" checked={selected.has(c._id)} disabled={!selectable(c) || busy}
      aria-label={`Select SO# ${c.soNumber || '—'}`} onClick={(e) => e.stopPropagation()} onChange={() => toggle(c)} {...extra} />
  );
  const groupCheckbox = (g) => {
    const s = groupState(g);
    return (
      <input type="checkbox" className="fr-chk" checked={s.all} disabled={s.none || busy} aria-label={`Select ${g.name}`}
        ref={(el) => { if (el) el.indeterminate = s.some; }} onChange={() => toggleGroup(g)} />
    );
  };
  const amountCell = (c) => (c.amountCents > 0 ? formatCents(c.amountCents) : <span className="fr-miss">No price</span>);
  const terms = (g) => (g.unmatched
    ? <span className="fr-terms unmatched">Carrier not recognised</span>
    : <span className={`fr-terms${g.perInvoice ? ' invoice' : ''}`}>{g.perInvoice ? 'Paid per invoice' : 'Paid per delivery'}</span>);
  const enterInvoice = (g) => (g.perInvoice && canAdd && g.items.some((c) => c.status === 'draft' && !c.invoiceId) ? (
    <button type="button" className="fr-btn sm" onClick={(e) => { e.stopPropagation(); act.newInvoice(g.carrier); }}>
      <Receipt size={14} aria-hidden="true" />Enter invoice
    </button>
  ) : null);

  return (
    <div className="fr">
      <div className="fr-page">
        <div className="fr-head">
          {sidebarToggle}
          <h1 className="fr-title">3rd-Party Freight</h1>
          <span className="fr-grow" />
          <label className="fr-search">
            <Search size={16} aria-hidden="true" />
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="SO#, BOL, customer, payment ID" aria-label="Search charges" />
            {search ? <button type="button" className="fr-search-clear" onClick={() => setSearch('')} aria-label="Clear search"><X size={14} /></button> : null}
          </label>
          <LocationFilter
            options={[]}
            value=""
            onChange={() => {}}
            user={user}
            active={filterActive}
            onClear={() => { setLocation(''); setCarrierId(''); }}
            wide
          >
            {branchOptions.length > 1 ? (
              <LocationField options={locationNames(branchOptions)} value={location} onChange={(v) => setLocation(v || '')} user={user} />
            ) : null}
            <div className="lf-group">
              <label className="lf-group-label" htmlFor="fr-carrier-filter">Carrier</label>
              <select id="fr-carrier-filter" className="lf-select" value={carrierId} onChange={(e) => setCarrierId(e.target.value)}>
                <option value="">All carriers</option>
                {carriers.map((c) => <option key={c._id} value={c._id}>{c.name}{c.active === false ? ' (deactivated)' : ''}</option>)}
              </select>
            </div>
          </LocationFilter>
          <div className="fr-more" ref={menuRef}>
            <button type="button" className="fr-icon-btn" aria-label="More" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
              <MoreHorizontal size={18} aria-hidden="true" />
            </button>
            {menuOpen ? (
              <div className="fr-menu" role="menu">
                {(has(user, CARRIERS.VIEW) || has(user, FREIGHT.VIEW)) ? (
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setPanel({ type: 'carriers' }); }}><Truck size={16} aria-hidden="true" />Carriers</button>
                ) : null}
                {canAdd ? (
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); act.newInvoice(null); }}><Receipt size={16} aria-hidden="true" />Enter carrier invoice</button>
                ) : null}
                {has(user, FREIGHT.EXPORT) ? (
                  <button type="button" role="menuitem" disabled={exporting} onClick={exportExcel}><Download size={16} aria-hidden="true" />{exporting ? 'Exporting…' : 'Export to Excel'}</button>
                ) : null}
              </div>
            ) : null}
          </div>
          {canAdd ? (
            <button type="button" className="fr-btn gold fr-add" onClick={() => setForm({ type: 'charge', charge: null })} aria-label="Add charge" title="Add a charge by hand">
              <Plus size={16} aria-hidden="true" /><span className="fr-add-label">Add charge</span>
            </button>
          ) : null}
        </div>

        <div className="fr-tiles">
          <div className="fr-tile">
            <span className="k">To approve</span>
            <span className="v">{formatCents(summary.draft?.cents || 0)}</span>
            <span className="s">{plural(summary.draft?.count || 0, 'charge')}{summary.missingPrice ? ` · ${summary.missingPrice} missing a price` : ''}</span>
          </div>
          <div className="fr-tile">
            <span className="k">Owed</span>
            <span className="v">{formatCents(summary.approved?.cents || 0)}</span>
            <span className="s">{plural(summary.approved?.count || 0, 'charge')} approved, not paid</span>
          </div>
          <div className="fr-tile">
            <span className="k">Paid</span>
            <span className="v">{formatCents(summary.paid?.cents || 0)}</span>
            <span className="s">{plural(summary.paid?.count || 0, 'charge')}</span>
          </div>
          {summary.flagged ? (
            <button type="button" className="fr-tile review" onClick={() => setTab('to_approve')}>
              <span className="k">Needs review</span>
              <span className="v">{summary.flagged}</span>
              <span className="s">Delivery changed or removed</span>
            </button>
          ) : (
            <div className="fr-tile">
              <span className="k">Needs review</span>
              <span className="v">0</span>
              <span className="s">Nothing flagged</span>
            </div>
          )}
        </div>

        <div className="fr-tabs" role="tablist" aria-label="Charges">
          {FREIGHT_TABS.map((t) => (
            <button key={t.id} type="button" role="tab" className="fr-tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
              <span className="fr-cnt">{tabCount(t.id, summary)}</span>
              {t.id === 'to_approve' && summary.flagged ? <span className="fr-cnt review" title={`${summary.flagged} need review`}>{summary.flagged} to review</span> : null}
            </button>
          ))}
        </div>

        {error ? (
          <div className="fr-note error" role="alert">
            <AlertTriangle size={18} aria-hidden="true" />
            <span className="fr-grow">{error}</span>
            <button type="button" className="fr-btn sm" onClick={() => { setError(''); refresh(); }}>Retry</button>
          </div>
        ) : null}

        <div className={`fr-card${items.length ? ' has-cards' : ''}`}>
          {loading && !data ? <Loading /> : null}
          {data && !items.length ? (
            <div className="fr-empty"><h3>{(debounced || filterActive) ? 'No charges match' : EMPTY[tab][0]}</h3>{(debounced || filterActive) ? 'Try another search, branch or carrier.' : EMPTY[tab][1]}</div>
          ) : null}
          {items.length ? (
            <>
              <div className="fr-table-wrap">
                <table className="fr-table">
                  <thead>
                    <tr>
                      <th className="chk-cell" aria-label="Select" />
                      <th>Date</th><th>SO#</th><th>Customer</th>{showBranch ? <th>Branch</th> : null}<th>BOL #</th><th className="r">Amount</th><th>Status</th>
                    </tr>
                  </thead>
                  {groups.map((g) => (
                    <tbody key={g.key}>
                      <tr className="fr-grp">
                        <td className="chk-cell">{groupCheckbox(g)}</td>
                        <td colSpan={showBranch ? 5 : 4}>
                          <span className="fr-grp-name">{g.name} {terms(g)} <span className="fr-sub">· {plural(g.items.length, 'charge')}</span> {enterInvoice(g)}</span>
                        </td>
                        <td className="r">{formatCents(g.cents)}</td>
                        <td />
                      </tr>
                      {g.items.map((c) => (
                        <tr key={c._id} className={`fr-row${selected.has(c._id) ? ' is-selected' : ''}`} onClick={() => act.openCharge(c._id)}>
                          <td className="chk-cell">{rowCheckbox(c)}</td>
                          <td>{shortDate(c.deliveryDate)}</td>
                          <td className="fr-so">{c.soNumber || '—'}</td>
                          <td>{c.customerName || c.description || '—'}</td>
                          {showBranch ? <td>{c.location}</td> : null}
                          <td>{c.bolNumber || '—'}</td>
                          <td className="r">{amountCell(c)}</td>
                          <td><StatusCell charge={c} showPaymentId={c.status === 'paid'} /></td>
                        </tr>
                      ))}
                    </tbody>
                  ))}
                </table>
              </div>

              <div className="fr-cards">
                {groups.map((g) => (
                  <React.Fragment key={g.key}>
                    <div className="fr-cards-grp">
                      {groupCheckbox(g)}
                      <b>{g.name}</b>{terms(g)}{enterInvoice(g)}
                      <span className="fr-grow" />
                      <b>{formatCents(g.cents)}</b>
                    </div>
                    <div className="fr-cards-grid">
                      {g.items.map((c) => (
                        <div key={c._id} className={`fr-ccard${selected.has(c._id) ? ' is-selected' : ''}${openFlagsOf(c).length ? ' flagged' : ''}`}
                          onClick={() => act.openCharge(c._id)}>
                          {rowCheckbox(c)}
                          <div className="fr-ccard-main">
                            <div className="fr-ccard-top"><b>SO# {c.soNumber || '—'}</b><span className="fr-grow" /><b>{amountCell(c)}</b></div>
                            <div className="fr-ccard-name">{c.customerName || c.description || '—'}</div>
                            <div className="fr-ccard-meta">{[shortDate(c.deliveryDate), showBranch ? c.location : null, c.bolNumber].filter(Boolean).join(' · ')}</div>
                            <StatusCell charge={c} showPaymentId={c.status === 'paid'} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </React.Fragment>
                ))}
              </div>
            </>
          ) : null}
        </div>

        {data && data.total > 0 ? (
          <div className="fr-pager">
            <Pagination currentPage={currentPage} totalPages={Math.max(1, Math.ceil(data.total / rowsPerPage))} onPageChange={setCurrentPage}
              rowsPerPage={rowsPerPage} onRowsPerPageChange={setRowsPerPage} totalCount={data.total} />
          </div>
        ) : null}
      </div>

      {bar.count > 0 && !panel ? (
        <div className="fr-bar" role="region" aria-label="Selected charges">
          <span className="fr-bar-sum">{bar.count}<span className="fr-bar-word"> selected</span> · {formatCents(bar.cents)}</span>
          <button type="button" className="fr-btn ghost fr-bar-clear" onClick={() => setSelected(new Map())}>Clear</button>
          {!bar.pay && bar.payBlocked ? <span className="fr-bar-note">{bar.payBlocked}</span> : null}
          {bar.sendBack || bar.approve || bar.pay ? (
            <span className="fr-bar-actions">
              {bar.sendBack ? <button type="button" className="fr-btn dark" disabled={busy} onClick={() => act.sendBack(selectedList)}>Send back</button> : null}
              {bar.approve ? <button type="button" className="fr-btn dark" disabled={busy} onClick={() => act.approve(selectedList)}>Approve</button> : null}
              {bar.pay ? <button type="button" className="fr-btn gold" disabled={busy} onClick={() => act.pay(selectedList)}>{bar.pay}</button> : null}
            </span>
          ) : null}
        </div>
      ) : null}

      {toast ? (
        <div className="fr-toast" role="status">
          <CheckCircle2 size={18} className="ok" aria-hidden="true" />
          <span>{toast.text}{toast.paymentId ? <> · <span className="fr-mono">{toast.paymentId}</span></> : null}</span>
          {toast.paymentId ? <button type="button" className="fr-btn sm" onClick={() => { setPanel({ type: 'payment', id: toast.paymentId }); setToast(null); }}>View payment</button> : null}
          <button type="button" className="fr-search-clear" aria-label="Dismiss" onClick={() => setToast(null)}><X size={14} /></button>
        </div>
      ) : null}

      {panel?.type === 'charge' ? <ChargePanel id={panel.id} user={user} reloadKey={reloadKey} act={act} onClose={() => setPanel(null)} /> : null}
      {panel?.type === 'invoice' ? <InvoicePanel id={panel.id} user={user} reloadKey={reloadKey} act={act} onClose={() => setPanel(null)} /> : null}
      {panel?.type === 'payment' ? <PaymentPanel paymentId={panel.id} act={act} onClose={() => setPanel(null)} /> : null}
      {panel?.type === 'carriers' ? <CarriersPanel user={user} reloadKey={reloadKey} act={act} onClose={() => setPanel(null)} /> : null}

      {form?.type === 'pay' ? (() => {
        const cs = form.charges;
        const oneStep = cs.some((c) => c.status === 'draft');
        const n = plural(cs.length, 'charge');
        const sos = cs.map((c) => c.soNumber).filter(Boolean);
        return (
          <PayForm
            title={oneStep ? 'Approve & pay' : 'Mark paid'}
            kicker={`${cs[0].carrier?.name || carrierName(cs[0].carrierId)} · ${n}`}
            cents={cs.reduce((s, c) => s + (c.amountCents || 0), 0)}
            sub={sos.length ? `SO# ${sos.slice(0, 8).join(', ')}${sos.length > 8 ? ` and ${sos.length - 8} more` : ''}` : ''}
            oneStep={oneStep}
            submitLabel={oneStep ? `Approve & pay ${n}` : `Mark ${n} paid`}
            onClose={closeForm}
            onPay={async (payment) => {
              const r = await api.payCharges(cs, payment);
              done(paidToast(r, n));
            }}
          />
        );
      })() : null}
      {form?.type === 'payInvoice' ? (
        <PayForm
          title={form.invoice.status === 'draft' ? 'Approve & pay invoice' : 'Pay invoice'}
          kicker={`${form.invoice.carrier?.name || 'Carrier'} · invoice #${form.invoice.invoiceNumber}`}
          cents={form.invoice.totalCents}
          sub={plural(form.invoice.chargeIds?.length || form.invoice.charges?.length || 0, 'charge')}
          oneStep={form.invoice.status === 'draft'}
          submitLabel={form.invoice.status === 'draft' ? 'Approve & pay invoice' : 'Mark invoice paid'}
          onClose={closeForm}
          onPay={async (payment) => {
            const r = await api.invoiceStep(form.invoice, 'pay', payment);
            done(paidToast(r, `invoice #${form.invoice.invoiceNumber}`));
          }}
        />
      ) : null}
      {form?.type === 'void' ? (
        <VoidForm title={<>Void charge <span className="fm-title-sub">· SO# {form.charge.soNumber || '—'}</span></>} submitLabel="Void charge" onClose={closeForm}
          onVoid={async (reason) => { await api.voidCharge(form.charge, reason); done({ text: 'Charge voided — it stays on record under All' }); }} />
      ) : null}
      {form?.type === 'voidInvoice' ? (
        <VoidForm title={<>Void invoice <span className="fm-title-sub">· #{form.invoice.invoiceNumber}</span></>} submitLabel="Void invoice" onClose={closeForm}
          onVoid={async (reason) => { await api.invoiceStep(form.invoice, 'void', { reason }); done({ text: 'Invoice voided — its charges are back waiting for approval' }); }} />
      ) : null}
      {form?.type === 'charge' ? (
        <ChargeForm
          charge={form.charge}
          carriers={carriers}
          branches={locationNames(branchOptions).length ? locationNames(branchOptions) : (user?.assignedLocations || []).filter((l) => l !== '*')}
          defaultBranch={location || homeLocationOf(user)}
          onClose={closeForm}
          onSave={async (body) => {
            if (form.charge) { await api.editCharge(form.charge, body); done({ text: 'Charge saved' }); }
            else { await api.addCharge(body); done({ text: 'Charge added — it’s waiting for approval' }); }
          }}
        />
      ) : null}
      {form?.type === 'invoice' ? (
        <InvoiceForm
          invoice={form.invoice}
          carriers={carriers}
          carrierId={form.carrierId}
          onClose={closeForm}
          onSave={async (body) => {
            if (form.invoice) { await api.editInvoice(form.invoice, body); done({ text: 'Invoice saved' }); }
            else {
              const inv = await api.addInvoice(body);
              done({ text: `Invoice #${inv.invoiceNumber} saved` });
              setPanel({ type: 'invoice', id: String(inv._id) });
            }
          }}
        />
      ) : null}
      {form?.type === 'carrier' ? (
        <CarrierForm
          carrier={form.carrier}
          initialName={form.name}
          canDeactivate={has(user, CARRIERS.DEACTIVATE)}
          onClose={closeForm}
          onSave={async (body) => {
            if (form.carrier) { await api.editCarrier(form.carrier, body); done({ text: 'Carrier saved' }); }
            else { await api.addCarrier(body); done({ text: `${body.name} added — waiting charges with that name are matched to it` }); }
          }}
          onSetActive={async (active) => {
            await api.setCarrierActive(form.carrier, active);
            done({ text: active ? 'Carrier reactivated' : 'Carrier deactivated' });
          }}
        />
      ) : null}
    </div>
  );
}
