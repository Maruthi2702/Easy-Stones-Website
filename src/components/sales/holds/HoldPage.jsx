import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, Printer, Pencil, MoreHorizontal, Timer, AlertTriangle, Check, CheckCircle2, X, Loader2, Repeat,
  Plus, Unlock, Phone, Mail
} from 'lucide-react';
import {
  getHold, editHoldDetails, changeHoldSlabs, swapHoldSlab, setHoldPrices, extendHold, releaseHold
} from '../../../api/holds';
import { lotGroups, holdTotals, formatMoney, formatSf, priceCentsOf, holdState } from '../../../holds/holdRules';
import { CART, can } from '../../../holds/permissions';
import { formatCents } from '../../../accounting/money';
import {
  expiryLine, elapsedShare, holdActions, longDate, dayMonth, dateOf, dateTimeOf, releaseDayOf, stateLabel, priceDraftOf,
  sharedPrice, priceChanges, lineAmount, cartSlabsFor, historyLabel, changeText, visibleChanges, chanceText, slabCount
} from '../../../utils/holdView';
import { useCart, cartActions } from './cartStore';
import { DetailsForm, ExtendForm, ReleaseForm, SwapForm, AddSlabsForm } from './HoldForms';
import HoldPrintPreview from './HoldPrintPreview';

/** A small menu under a button; closes on a click outside or Esc. */
function useMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return { open, setOpen, ref };
}

function LotNote({ group }) {
  if (group.slabs < 2) return null;
  return group.mixedLots ? (
    <span className="hl-lot warn"><AlertTriangle size={13} aria-hidden="true" />{group.bundles.length} bundles · colour may vary</span>
  ) : (
    <span className="hl-lot ok"><Check size={13} aria-hidden="true" />One bundle · colours match</span>
  );
}

function History({ entries }) {
  if (!entries.length) return <p className="hl-muted">Nothing yet.</p>;
  return (
    <ol className="hl-history">
      {entries.map((e) => (
        <li key={e._id} className={`hl-ev ${e.action}`}>
          <span className="hl-ev-dot" aria-hidden="true" />
          <div>
            <b>{historyLabel(e.action)}</b>
            <span className="hl-muted"> · {e.by?.name || 'System'} · {dateTimeOf(e.at)}</span>
            {e.note ? <div className="hl-muted">{e.note}</div> : null}
            {visibleChanges(e).length ? <div className="hl-muted">{visibleChanges(e).map(changeText).join('; ')}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * One hold (the canvas's "Hold page"): who it's for, until when, every slab
 * and its price, notes and the full history — with each change behind its own
 * permission (holdActions). Every save sends the version it was based on, so
 * a change made elsewhere in the meantime is refused, not overwritten.
 */
export default function HoldPage({ id, user, sidebarToggle, onBack }) {
  const [hold, setHold] = useState(null);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [pageTab, setPageTab] = useState('slabs');
  const [draft, setDraft] = useState(null); // prices being edited: { [slabKey]: "22.00" }
  const [priceErrors, setPriceErrors] = useState({});
  const [selected, setSelected] = useState(() => new Set());
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [form, setForm] = useState(null); // { type: 'details'|'extend'|'release'|'swap'|'add', line? }
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);
  const moreMenu = useMenu();
  const { cart, loaded: cartLoaded, reservationsTick } = useCart();

  useEffect(() => {
    let live = true;
    getHold(id)
      .then((h) => { if (live) { setHold(h); setError(''); } })
      .catch((err) => { if (live) setError(err.message); });
    return () => { live = false; };
  }, [id, reloadKey]);

  // Someone else held or released slabs: catch up, unless a change is half-typed here.
  const [seenTick, setSeenTick] = useState(reservationsTick);
  if (seenTick !== reservationsTick && !draft && !form) {
    setSeenTick(reservationsTick);
    setReloadKey((k) => k + 1);
  }

  const canCart = can(user, CART.USE);
  useEffect(() => {
    if (canCart && !cartLoaded) cartActions.load();
  }, [canCart, cartLoaded]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  if (!hold) {
    return (
      <div className="hl-page">
        <div className="hl-head">
          {sidebarToggle}
          <button type="button" className="hl-back" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" />Holds</button>
        </div>
        {error ? (
          <div className="hl-note error" role="alert"><AlertTriangle size={18} aria-hidden="true" /><span>{error}</span></div>
        ) : <div className="hl-loading"><Loader2 size={28} className="hl-spin" aria-label="Loading" /></div>}
      </div>
    );
  }

  const now = new Date();
  const state = holdState(hold, now);
  const act = holdActions(user, hold);
  const exp = expiryLine(hold, now);
  const groups = lotGroups(hold.lines);
  const pricedLines = draft ? hold.lines.map((l) => ({ ...l, priceCentsPerSf: priceCentsOf(draft[l.slabKey] ?? '') ?? null })) : hold.lines;
  const totals = holdTotals(pricedLines);
  const offered = act.slabs && canCart ? cartSlabsFor(hold, cart.lines) : [];
  const history = hold.history || null;
  const selectable = act.slabs && !draft;
  const allSelected = selected.size > 0 && selected.size === hold.lines.length;

  /** Run a change; the page shows the saved hold and reloads its history. */
  // A form shows its own error (it rethrows); elsewhere the toast does.
  const run = async (fn, message, { inForm = false } = {}) => {
    setBusy(true);
    try {
      const saved = await fn();
      setHold((prev) => ({ ...saved, history: prev?.history }));
      setReloadKey((k) => k + 1);
      if (message) setToast({ text: typeof message === 'function' ? message(saved) : message });
      return saved;
    } catch (err) {
      if (!inForm) setToast({ text: err.message, error: true });
      if (err.status === 409) setReloadKey((k) => k + 1);
      throw err;
    } finally {
      setBusy(false);
    }
  };
  const closeForm = () => setForm(null);
  const formSave = (fn, message) => async (...args) => { await run(() => fn(...args), message, { inForm: true }); setForm(null); };

  const toggle = (key) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const toggleGroup = (g) => setSelected((s) => {
    const next = new Set(s);
    const all = g.lines.every((l) => next.has(l.slabKey));
    g.lines.forEach((l) => (all ? next.delete(l.slabKey) : next.add(l.slabKey)));
    return next;
  });

  const removeSelected = async () => {
    const keys = [...selected];
    try {
      await run(() => changeHoldSlabs(hold, { remove: keys }), `Removed ${slabCount(keys.length)} — free for others now`);
      setSelected(new Set());
    } catch { /* toast shows why */ }
    setConfirmRemove(false);
  };

  const startPrices = () => { setDraft(priceDraftOf(hold.lines)); setPriceErrors({}); setSelected(new Set()); };
  const setGroupPrice = (g, value) => setDraft((d) => ({ ...d, ...Object.fromEntries(g.lines.map((l) => [l.slabKey, value])) }));
  const savePrices = async () => {
    const { changed, errors } = priceChanges(hold.lines, draft);
    setPriceErrors(errors);
    if (Object.keys(errors).length) return;
    if (!changed.length) { setDraft(null); return; }
    try {
      await run(() => setHoldPrices(hold, changed), `Prices saved for ${slabCount(changed.length)}`);
      setDraft(null);
    } catch { /* toast shows why; the draft stays */ }
  };

  const c = hold.customer || {};
  const showMore = act.release;

  return (
    <div className="hl-page hl-hold">
      <div className="hl-head">
        {sidebarToggle}
        <button type="button" className="hl-back" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" /><span className="hl-back-label">Holds</span></button>
        <h1 className="hl-title">Hold #{hold.number}</h1>
        <span className={`hl-pill ${state}`}>{stateLabel(state)}</span>
        <span className="hl-grow" />
        <div className="hl-head-actions">
          {act.print ? (
            <button type="button" className="hl-btn" onClick={() => setPrinting(true)}><Printer size={16} aria-hidden="true" /><span className="hl-btn-label">Print</span></button>
          ) : null}
          {act.edit ? (
            <button type="button" className="hl-btn" onClick={() => setForm({ type: 'details' })}><Pencil size={16} aria-hidden="true" /><span className="hl-btn-label">Edit</span></button>
          ) : null}
          {showMore ? (
            <div className="hl-menu-wrap" ref={moreMenu.ref}>
              <button type="button" className="hl-icon-btn" aria-label="More" aria-haspopup="menu" aria-expanded={moreMenu.open} onClick={() => moreMenu.setOpen((o) => !o)}>
                <MoreHorizontal size={18} aria-hidden="true" />
              </button>
              {moreMenu.open ? (
                <div className="hl-menu" role="menu">
                  <button type="button" role="menuitem" className="danger" onClick={() => { moreMenu.setOpen(false); setForm({ type: 'release' }); }}>
                    <Unlock size={16} aria-hidden="true" />Release hold
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* When it ends, and what happens then */}
      <div className={`hl-strip ${exp.tone}`}>
        <div className="hl-strip-main">
          {state === 'released' ? (
            <span><b>Released {dateOf(hold.releasedAt)}</b>{hold.releasedBy?.name ? ` by ${hold.releasedBy.name}` : ''}{hold.releaseReason ? ` — ${hold.releaseReason}` : ''}</span>
          ) : state === 'expired' ? (
            <span><b>Expired {longDate(hold.expiresOn)}</b> — the slabs stay held until {dayMonth(releaseDayOf(hold))}, then are released automatically.{act.extend ? ' Extend it to keep them.' : ''}</span>
          ) : (
            <>
              <span>Hold until <b>{longDate(hold.expiresOn)}</b></span>
              <span className={`hl-exp-chip ${exp.tone}`}>{exp.text}</span>
            </>
          )}
          {state === 'active' ? <span className="hl-bar" aria-hidden="true"><span style={{ width: `${Math.round(elapsedShare(hold, now) * 100)}%` }} /></span> : null}
        </div>
        {act.extend ? (
          <button type="button" className="hl-btn" onClick={() => setForm({ type: 'extend' })}><Timer size={16} aria-hidden="true" />Extend</button>
        ) : null}
      </div>

      <div className="hl-cards2">
        <section className="hl-sec" aria-label="Bill to">
          <h3>Bill to</h3>
          <div className="hl-billto">
            <b>{c.name || '—'}</b>
            {c.address ? <span className="hl-addr">{c.address}</span> : null}
            {c.contact ? <span>{c.contact}</span> : null}
            <span className="hl-contact-links">
              {c.phone ? <a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}><Phone size={14} aria-hidden="true" />{c.phone}</a> : null}
              {c.email ? <a href={`mailto:${c.email}`}><Mail size={14} aria-hidden="true" />{c.email}</a> : null}
            </span>
          </div>
        </section>
        <section className="hl-sec" aria-label="Hold">
          <h3>Hold</h3>
          <dl className="hl-kv">
            <dt>Job / reference</dt><dd>{hold.job || '—'}</dd>
            <dt>Chance to close</dt><dd>{chanceText(hold.chanceToClose)}</dd>
            <dt>Branch</dt><dd>{hold.branch}</dd>
            <dt>Sales rep</dt><dd>{hold.createdBy?.name || '—'}</dd>
            <dt>Created</dt><dd>{dateTimeOf(hold.createdAt)}</dd>
            {hold.updatedBy?.name && hold.updatedAt !== hold.createdAt ? <><dt>Last changed</dt><dd>{dateTimeOf(hold.updatedAt)} by {hold.updatedBy.name}</dd></> : null}
          </dl>
        </section>
      </div>

      <div className="hl-tabs" role="tablist" aria-label="Hold">
        <button type="button" role="tab" className="hl-tab" aria-selected={pageTab === 'slabs'} onClick={() => setPageTab('slabs')}>Slabs <span className="hl-cnt">{hold.lines.length}</span></button>
        <button type="button" role="tab" className="hl-tab" aria-selected={pageTab === 'notes'} onClick={() => setPageTab('notes')}>Notes</button>
        {history ? <button type="button" role="tab" className="hl-tab" aria-selected={pageTab === 'history'} onClick={() => setPageTab('history')}>History <span className="hl-cnt">{history.length}</span></button> : null}
      </div>

      {pageTab === 'slabs' ? (
        <>
          {(act.prices || offered.length > 0) ? (
            <div className="hl-slab-tools">
              {offered.length > 0 && !draft ? (
                <button type="button" className="hl-btn" onClick={() => setForm({ type: 'add' })}><Plus size={16} aria-hidden="true" />Add from cart ({offered.length})</button>
              ) : null}
              <span className="hl-grow" />
              {act.prices && !draft ? <button type="button" className="hl-btn" onClick={startPrices}><Pencil size={16} aria-hidden="true" />Edit prices</button> : null}
              {draft ? (
                <>
                  <button type="button" className="hl-btn" disabled={busy} onClick={() => { setDraft(null); setPriceErrors({}); }}>Cancel</button>
                  <button type="button" className="hl-btn gold" disabled={busy} onClick={savePrices}>{busy ? 'Saving…' : 'Save prices'}</button>
                </>
              ) : null}
            </div>
          ) : null}
          {Object.keys(priceErrors).length ? (
            <div className="hl-note error" role="alert"><AlertTriangle size={18} aria-hidden="true" /><span>Enter each price like 12.50 — or leave it blank for no price yet.</span></div>
          ) : null}

          {groups.map((g) => {
            const groupTotals = holdTotals(pricedLines.filter((l) => l.product === g.product));
            const groupAll = g.lines.every((l) => selected.has(l.slabKey));
            return (
              <section key={g.product} className="hl-group">
                <div className="hl-group-head">
                  {selectable ? (
                    <input type="checkbox" className="hl-chk" checked={groupAll} aria-label={`Select every ${g.product} slab`} onChange={() => toggleGroup(g)} />
                  ) : null}
                  <div className="hl-group-name">
                    <b>{g.product}</b>
                    <span className="hl-muted">{slabCount(g.slabs)} · {formatSf(g.sfHundredths)}</span>
                    <LotNote group={g} />
                  </div>
                  {draft ? (
                    <label className="hl-price-all">
                      <span>Price / SF for all</span>
                      <input className="hl-price" inputMode="decimal" placeholder="$0.00" value={sharedPrice(g.lines, draft)}
                        onChange={(e) => setGroupPrice(g, e.target.value)} aria-label={`Price per SF for every ${g.product} slab`} />
                    </label>
                  ) : null}
                  <span className="hl-group-total">
                    {groupTotals.totalCents !== null ? formatMoney(groupTotals.totalCents) : groupTotals.pricedCents ? `${formatMoney(groupTotals.pricedCents)} so far` : <span className="hl-miss">No price</span>}
                  </span>
                </div>
                <div className={`hl-slabs${selectable ? ' has-chk' : ''}${act.slabs && !draft ? ' has-swap' : ''}`}>
                  <div className="hl-slab hl-slab-head" aria-hidden="true">
                    {selectable ? <span /> : null}
                    <span className="hl-s-serial">Serial #</span><span className="hl-s-barcode">Barcode</span><span className="hl-s-bundle">Bundle</span>
                    <span className="hl-s-slab">Slab · block</span><span className="hl-s-bin">Bin</span><span className="hl-s-size">Size</span>
                    <span className="r">$/SF</span><span className="r">Amount</span>
                    {act.slabs && !draft ? <span /> : null}
                  </div>
                  {g.lines.map((l) => {
                    const amount = lineAmount(l, draft);
                    return (
                      <div key={l.slabKey} className={`hl-slab${selected.has(l.slabKey) ? ' is-selected' : ''}`}>
                        {selectable ? (
                          <span className="hl-s-chk"><input type="checkbox" className="hl-chk" checked={selected.has(l.slabKey)} onChange={() => toggle(l.slabKey)} aria-label={`Select ${l.serial || l.slabKey}`} /></span>
                        ) : null}
                        <span className="hl-s-serial"><b>{l.serial || l.slabKey}</b>{l.note ? <span className="hl-s-note">{l.note}</span> : null}</span>
                        <span className="hl-s-barcode">{l.barcode || '—'}</span>
                        <span className="hl-s-bundle">{l.bundle || '—'}</span>
                        <span className="hl-s-slab">{[l.slabNumber, l.block].filter(Boolean).join(' · ') || '—'}</span>
                        <span className="hl-s-bin">{l.bin || '—'}</span>
                        <span className="hl-s-size">{[l.dimensions, formatSf(l.sfHundredths)].filter(Boolean).join(' · ')}</span>
                        <span className="hl-s-price r">
                          {draft ? (
                            <input className={`hl-price${priceErrors[l.slabKey] ? ' bad' : ''}`} inputMode="decimal" placeholder="$0.00" value={draft[l.slabKey] ?? ''}
                              aria-invalid={Boolean(priceErrors[l.slabKey])} aria-label={`Price per SF for ${l.serial || l.slabKey}`}
                              onChange={(e) => setDraft((d) => ({ ...d, [l.slabKey]: e.target.value }))} />
                          ) : l.priceCentsPerSf !== null && l.priceCentsPerSf !== undefined ? `${formatCents(l.priceCentsPerSf)}` : <span className="hl-miss">—</span>}
                        </span>
                        <span className="hl-s-amount r">{amount !== null ? formatMoney(amount) : <span className="hl-miss">No price</span>}</span>
                        {act.slabs && !draft ? (
                          <span className="hl-s-swap">
                            <button type="button" className="hl-btn sm" onClick={() => setForm({ type: 'swap', line: l })} aria-label={`Swap ${l.serial || l.slabKey}`}>
                              <Repeat size={14} aria-hidden="true" /><span className="hl-btn-label">Swap</span>
                            </button>
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}

          <div className="hl-totals">
            <div><span>Subtotal · {slabCount(totals.slabs)} · {formatSf(totals.sfHundredths)}</span><b>{formatMoney(totals.pricedCents)}</b></div>
            <div className="hl-total-line">
              <span>{totals.missingPrices ? 'Total so far' : 'Total'}</span>
              <b>{totals.missingPrices === totals.slabs ? '—' : formatMoney(totals.pricedCents)}</b>
            </div>
            {totals.missingPrices ? <div className="hl-miss">{slabCount(totals.missingPrices)} {totals.missingPrices === 1 ? 'has' : 'have'} no price yet</div> : null}
          </div>
        </>
      ) : null}

      {pageTab === 'notes' ? (
        <div className="hl-notes">
          <section className="hl-sec">
            <h3>Internal notes {act.edit ? <button type="button" className="hl-link" onClick={() => setForm({ type: 'details' })}>Edit</button> : null}</h3>
            <p className="hl-pre">{hold.notes || <span className="hl-muted">None</span>}</p>
          </section>
          <section className="hl-sec">
            <h3>Commission notes</h3>
            <p className="hl-pre">{hold.commissionNotes || <span className="hl-muted">None</span>}</p>
          </section>
          <section className="hl-sec">
            <h3>Slab notes</h3>
            {hold.lines.some((l) => l.note) ? (
              <dl className="hl-kv">
                {hold.lines.filter((l) => l.note).map((l) => <React.Fragment key={l.slabKey}><dt>{l.serial || l.slabKey}</dt><dd>{l.note}</dd></React.Fragment>)}
              </dl>
            ) : <p className="hl-muted">None</p>}
          </section>
        </div>
      ) : null}

      {pageTab === 'history' && history ? <section className="hl-sec"><History entries={history} /></section> : null}

      {selected.size > 0 && !draft ? (
        <div className="hl-selbar" role="region" aria-label="Selected slabs">
          {confirmRemove ? (
            <>
              <span className="hl-selbar-sum">Remove {slabCount(selected.size)} from Hold #{hold.number}?</span>
              <button type="button" className="hl-btn ghost" disabled={busy} onClick={() => setConfirmRemove(false)}>Cancel</button>
              <button type="button" className="hl-btn danger-solid" disabled={busy} onClick={removeSelected}>{busy ? 'Removing…' : 'Remove'}</button>
            </>
          ) : (
            <>
              <span className="hl-selbar-sum">{selected.size} selected</span>
              <button type="button" className="hl-btn ghost" onClick={() => setSelected(new Set())}>Clear</button>
              {allSelected ? (
                <span className="hl-selbar-note">A hold needs at least one slab{act.release ? ' — release it instead' : ''}.</span>
              ) : (
                <button type="button" className="hl-btn dark" onClick={() => setConfirmRemove(true)}>Remove from hold</button>
              )}
            </>
          )}
        </div>
      ) : null}

      {toast ? (
        <div className={`hl-toast${toast.error ? ' error' : ''}`} role="status">
          {toast.error ? <AlertTriangle size={18} aria-hidden="true" /> : <CheckCircle2 size={18} className="ok" aria-hidden="true" />}
          <span>{toast.text}</span>
          <button type="button" className="hl-x" aria-label="Dismiss" onClick={() => setToast(null)}><X size={14} /></button>
        </div>
      ) : null}

      {printing ? <HoldPrintPreview hold={hold} onClose={() => setPrinting(false)} /> : null}
      {form?.type === 'details' ? (
        <DetailsForm hold={hold} onClose={closeForm} onSave={formSave((patch) => editHoldDetails(hold, patch), 'Hold saved')} />
      ) : null}
      {form?.type === 'extend' ? (
        <ExtendForm hold={hold} onClose={closeForm} onSave={formSave((expiresOn) => extendHold(hold, expiresOn), (h) => `Held until ${longDate(h.expiresOn)}`)} />
      ) : null}
      {form?.type === 'release' ? (
        <ReleaseForm hold={hold} onClose={closeForm} onRelease={formSave((reason) => releaseHold(hold, reason), `Hold #${hold.number} released — its slabs are free`)} />
      ) : null}
      {form?.type === 'swap' ? (
        <SwapForm hold={hold} line={form.line} cartLines={cart.lines} onClose={closeForm}
          onSwap={formSave((to) => swapHoldSlab(hold, form.line.slabKey, to), (h) => `Swapped ${form.line.serial || form.line.slabKey} for ${h.lines.find((x) => !hold.slabKeys.includes(x.slabKey))?.serial || 'the new slab'}`)} />
      ) : null}
      {form?.type === 'add' ? (
        <AddSlabsForm hold={hold} offered={offered} onClose={closeForm}
          onAdd={formSave(async (add) => { const h = await changeHoldSlabs(hold, { add }); cartActions.load(); return h; }, (h) => `Added ${slabCount(h.lines.length - hold.lines.length)} to Hold #${hold.number}`)} />
      ) : null}
    </div>
  );
}
