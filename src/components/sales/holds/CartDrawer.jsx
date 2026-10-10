import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Maximize2, Minimize2, MoreHorizontal, ScanBarcode, Check, AlertTriangle, Lock, ArrowLeft, Trash2
} from 'lucide-react';
import { FormField, FormPicker, FormSearchPicker } from '../../shared/form/FormControls';
import useIsPhone from '../../shared/form/useIsPhone';
import { FormLayerContext } from '../../shared/form/formLayer';
import { useCustomerOptions } from '../../../api/customerOptions';
import { holdsMeta, createHold } from '../../../api/holds';
import {
  lotGroups, formatSf, holdTotals, priceCentsOf, addDays, todayIn, daysBetween, DEFAULT_HOLD_DAYS, formatMoney
} from '../../../holds/holdRules';
import { HOLDS, can } from '../../../holds/permissions';
import { branchZone } from '../../../config/branches';
import { useCart, cartActions } from './cartStore';
import '../../shared/form/FormModal.css';
import './CartDrawer.css';

/**
 * The cart (approved design, 2026-10-10): a drawer from the side rail that
 * expands to full width, with the hold checkout inside it. One cart per
 * person, saved on the server (src/holds/router.js); prices are typed at
 * checkout for now.
 */

const newRequestId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** Cart lines → the shape lotGroups and holdTotals read. */
const asLines = (cartLines) => cartLines.map((l) => ({
  ...(l.slab || {}),
  slabKey: l.slabKey,
  product: l.slab?.product || 'No longer in stock',
  note: l.note,
  othersInCart: l.othersInCart,
  lock: l.lock,
  inStock: l.inStock,
  sfHundredths: l.slab?.sfHundredths || 0
}));

const usable = (line) => line.inStock && !line.lock;

function LotBadge({ group }) {
  if (group.slabs < 2) return null;
  if (group.mixedLots) {
    return (
      <div className="cd-lot cd-lot-warn">
        <AlertTriangle size={14} aria-hidden="true" />
        From {group.bundles.length} bundles ({group.bundles.map((b) => b.bundle).join(', ')}) · colour may vary
      </div>
    );
  }
  return (
    <div className="cd-lot cd-lot-ok">
      <Check size={14} aria-hidden="true" />
      All {group.slabs} from bundle {group.bundles[0].bundle} · colours match
    </div>
  );
}

function CartView({ cart, lines, selected, setSelected, expanded, customers, customersLoading }) {
  const [code, setCode] = useState('');
  const [scanMsg, setScanMsg] = useState(null);
  const [scanning, setScanning] = useState(false);
  const scanRef = useRef(null);
  const groups = lotGroups(lines);

  const toggle = (key) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const toggleGroup = (group) => setSelected((s) => {
    const keys = group.lines.filter(usable).map((l) => l.slabKey);
    const allOn = keys.every((k) => s.has(k));
    const next = new Set(s);
    keys.forEach((k) => (allOn ? next.delete(k) : next.add(k)));
    return next;
  });

  const scan = async (e) => {
    e.preventDefault();
    const value = code.trim();
    if (!value || scanning) return;
    setScanning(true);
    try {
      const res = await cartActions.scan(value);
      if (res.added.length) setScanMsg({ ok: true, text: `${res.added[0]} added · ${res.slab?.product || ''}` });
      else setScanMsg({ ok: false, text: `${res.skipped[0]?.slabKey}: ${res.skipped[0]?.reason}` });
      setCode('');
    } catch (err) {
      setScanMsg({ ok: false, text: err.message });
    } finally {
      setScanning(false);
      scanRef.current?.focus();
    }
  };

  return (
    <>
      <div className="cd-for">
        <span className="cd-for-label">For</span>
        <div className="cd-for-picker">
          <FormSearchPicker
            id="cart-customer"
            value={cart.customer?.id || ''}
            onChange={(v) => cartActions.setCustomer(v)}
            options={customers}
            loading={customersLoading && customers.length === 0}
            selectedLabel={cart.customer?.name || ''}
            placeholder="Customer (optional)"
            sheetTitle="Customer"
          />
        </div>
        {cart.customer && (
          <button type="button" className="cd-link" onClick={() => cartActions.setCustomer(null)}>Clear</button>
        )}
      </div>

      <form className="cd-scan" onSubmit={scan}>
        <label className="cd-scan-box">
          <ScanBarcode size={18} aria-hidden="true" />
          <input
            ref={scanRef}
            value={code}
            onChange={(e) => { setCode(e.target.value); setScanMsg(null); }}
            placeholder="Scan or type barcode / serial #"
            aria-label="Scan or type a barcode or serial number"
            autoComplete="off"
            enterKeyHint="done"
          />
        </label>
        <button type="submit" className="fm-btn" disabled={!code.trim() || scanning}>Add</button>
      </form>
      {scanMsg && <div role="status" className={`cd-scan-msg ${scanMsg.ok ? 'ok' : 'bad'}`}>{scanMsg.text}</div>}

      {!lines.length && (
        <div className="cd-empty">
          <b>Your cart is empty</b>
          <span>Tick slabs on the Inventory screen, or scan a slab’s barcode above.</span>
        </div>
      )}

      {groups.map((group) => {
        const keys = group.lines.filter(usable).map((l) => l.slabKey);
        const allOn = keys.length > 0 && keys.every((k) => selected.has(k));
        return (
          <section key={group.product} className="cd-group" aria-label={group.product}>
            <div className="cd-group-head">
              <input
                type="checkbox"
                className="cd-chk"
                checked={allOn}
                disabled={!keys.length}
                onChange={() => toggleGroup(group)}
                aria-label={`Select all ${group.product}`}
              />
              <div className="cd-group-name">
                <b>{group.product}</b>
                <span>{group.slabs} slab{group.slabs === 1 ? '' : 's'} · {formatSf(group.sfHundredths)}</span>
              </div>
            </div>
            <LotBadge group={group} />
            {expanded && (
              <div className="cd-row cd-row-head" aria-hidden="true">
                <span /><span>Serial #</span><span>Barcode</span><span>Bundle</span><span>Slab · block</span><span>Bin</span><span>Size</span><span>Note for this slab</span><span />
              </div>
            )}
            {group.lines.map((line) => {
              const dead = !usable(line);
              return (
                <div key={line.slabKey} className={`cd-row${dead ? ' is-dead' : ''}`}>
                  <input
                    type="checkbox"
                    className="cd-chk"
                    checked={!dead && selected.has(line.slabKey)}
                    disabled={dead}
                    onChange={() => toggle(line.slabKey)}
                    aria-label={`Use ${line.slabKey}`}
                  />
                  <div className="cd-slab">
                    <b className="cd-serial">{line.serial || line.slabKey}</b>
                    {line.lock && <span className="cd-tag cd-tag-lock"><Lock size={11} aria-hidden="true" />On Hold #{line.lock.holdNumber}{line.lock.by ? ` · ${line.lock.by}` : ''}</span>}
                    {!line.inStock && <span className="cd-tag cd-tag-lock">No longer in stock</span>}
                    {!dead && line.othersInCart?.length > 0 && <span className="cd-tag cd-tag-others">{line.othersInCart.join(', ')} {line.othersInCart.length === 1 ? 'has' : 'have'} it in a cart</span>}
                    {!expanded && line.inStock && (
                      <span className="cd-sub">{[line.dimensions, formatSf(line.sfHundredths), line.bin && `bin ${line.bin}`].filter(Boolean).join(' · ')}{line.note ? ` · “${line.note}”` : ''}</span>
                    )}
                  </div>
                  {expanded && (
                    <>
                      <span className="cd-cell">{line.barcode || '—'}</span>
                      <span className="cd-cell">{line.bundle || '—'}</span>
                      <span className="cd-cell">{[line.slabNumber, line.block].filter(Boolean).join(' · ') || '—'}</span>
                      <span className="cd-cell">{line.bin || '—'}</span>
                      <span className="cd-cell">{line.dimensions ? `${line.dimensions} · ` : ''}{formatSf(line.sfHundredths)}</span>
                      <NoteInput line={line} />
                    </>
                  )}
                  <button type="button" className="cd-remove" onClick={() => cartActions.remove(line.slabKey)} aria-label={`Remove ${line.slabKey}`}>
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </section>
        );
      })}
    </>
  );
}

function NoteInput({ line }) {
  const [value, setValue] = useState(line.note || '');
  // A note saved elsewhere (another tab, the server) replaces what's shown.
  const [shownNote, setShownNote] = useState(line.note || '');
  if ((line.note || '') !== shownNote) {
    setShownNote(line.note || '');
    setValue(line.note || '');
  }
  const save = () => { if (value !== (line.note || '')) cartActions.setNote(line.slabKey, value); };
  return (
    <input
      className="cd-note"
      value={value}
      maxLength={300}
      placeholder="Add a note"
      aria-label={`Note for ${line.slabKey}`}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
    />
  );
}

const HOLD_LENGTHS = [7, 14, 30];

function CheckoutView({ user, cart, chosen, customers, customersLoading, onBack, onDone }) {
  const canExtend = can(user, HOLDS.EXTEND);
  const [meta, setMeta] = useState(null);
  const [customerId, setCustomerId] = useState(cart.customer?.id || '');
  const [branch, setBranch] = useState('');
  const [days, setDays] = useState(DEFAULT_HOLD_DAYS);
  const [customDate, setCustomDate] = useState('');
  const [job, setJob] = useState('');
  const [notes, setNotes] = useState('');
  const [prices, setPrices] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [tried, setTried] = useState(false);
  const requestId = useRef(newRequestId());

  useEffect(() => {
    let live = true;
    holdsMeta().then((m) => { if (live) { setMeta(m); setBranch((b) => b || m.defaultBranch); } }).catch((err) => live && setError(err.message));
    return () => { live = false; };
  }, []);

  const groups = lotGroups(chosen);
  const today = branch ? todayIn(branchZone(branch)) : null;
  const expiresOn = days === 'date' ? customDate : (today ? addDays(today, days) : '');
  const tooLong = expiresOn && today && daysBetween(today, expiresOn) > DEFAULT_HOLD_DAYS && !canExtend;
  const priceErrors = Object.fromEntries(Object.entries(prices).filter(([, v]) => priceCentsOf(v) === undefined).map(([k]) => [k, 'Enter the price like 12.50']));
  const priced = chosen.map((l) => ({ ...l, priceCentsPerSf: priceCentsOf(prices[l.product] ?? '') ?? null }));
  const totals = holdTotals(priced);
  const problems = {
    customer: !customerId ? 'Pick the customer.' : '',
    branch: !branch ? 'Pick the branch.' : '',
    expiry: !expiresOn ? 'Pick the date.' : (tooLong ? `Longer than ${DEFAULT_HOLD_DAYS} days needs the Extend permission.` : '')
  };
  const firstProblem = Object.values(problems).find(Boolean) || Object.values(priceErrors)[0] || '';

  const submit = async () => {
    setTried(true);
    if (firstProblem || saving) return;
    setSaving(true);
    setError('');
    try {
      const hold = await createHold({
        requestId: requestId.current,
        customerId,
        branch,
        expiresOn,
        job: job.trim(),
        notes: notes.trim(),
        lines: chosen.map((l) => ({ slabKey: l.slabKey, price: prices[l.product]?.trim() ? prices[l.product] : null, note: l.note || '' }))
      });
      onDone(hold);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  const shown = (key) => (tried ? problems[key] : '');

  return (
    <>
      <div className="cd-body">
        {error && <div className="cd-banner" role="alert"><AlertTriangle size={16} aria-hidden="true" />{error}</div>}
        {tried && firstProblem && !error && <div className="cd-banner" role="alert"><AlertTriangle size={16} aria-hidden="true" />{firstProblem}</div>}

        <FormField name="customer" id="co-customer" label="Customer" required error={shown('customer')}>
          <FormSearchPicker
            id="co-customer"
            value={customerId}
            onChange={setCustomerId}
            options={customers}
            loading={customersLoading && customers.length === 0}
            selectedLabel={cart.customer?.name || ''}
            placeholder="Search customers"
            sheetTitle="Customer"
            error={shown('customer')}
          />
        </FormField>

        {meta && meta.branches.length > 1 && (
          <FormField name="branch" id="co-branch" label="Branch" required error={shown('branch')}>
            <FormPicker id="co-branch" value={branch} onChange={setBranch} options={meta.branches.map((b) => ({ value: b, label: b }))} sheetTitle="Branch" />
          </FormField>
        )}

        <FormField name="expiry" id="co-days" label="Hold until" required error={shown('expiry')}>
          <div className="cd-chips" role="radiogroup" aria-label="Hold until">
            {HOLD_LENGTHS.map((d) => {
              const locked = d > DEFAULT_HOLD_DAYS && !canExtend;
              return (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={days === d}
                  className={`cd-chip${days === d ? ' on' : ''}`}
                  disabled={locked}
                  title={locked ? 'Needs the Extend permission' : undefined}
                  onClick={() => setDays(d)}
                >
                  {d} days{days === d && today ? ` · ${new Date(`${addDays(today, d)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}` : ''}
                </button>
              );
            })}
            <button type="button" role="radio" aria-checked={days === 'date'} className={`cd-chip${days === 'date' ? ' on' : ''}`} onClick={() => setDays('date')}>Pick a date</button>
          </div>
          {days === 'date' && (
            <input type="date" className="fm-input cd-date" value={customDate} min={today || undefined} onChange={(e) => setCustomDate(e.target.value)} aria-label="Hold until date" />
          )}
        </FormField>

        <FormField name="job" id="co-job" label="Job / reference">
          <input id="co-job" className="fm-input" value={job} maxLength={200} onChange={(e) => setJob(e.target.value)} />
        </FormField>

        <div className="cd-prices">
          <div className="cd-prices-head">Price / SF</div>
          {groups.map((g) => (
            <div key={g.product} className="cd-price-row">
              <div>
                <b>{g.product}</b>
                <span className={g.mixedLots ? 'warn' : ''}>{g.slabs} slab{g.slabs === 1 ? '' : 's'} · {formatSf(g.sfHundredths)}{g.mixedLots ? ` · ${g.bundles.length} bundles, colour may vary` : ''}</span>
              </div>
              <input
                className={`cd-price${priceErrors[g.product] ? ' bad' : ''}`}
                value={prices[g.product] ?? ''}
                inputMode="decimal"
                placeholder="$0.00"
                aria-label={`Price per SF for ${g.product}`}
                aria-invalid={Boolean(priceErrors[g.product])}
                onChange={(e) => setPrices((p) => ({ ...p, [g.product]: e.target.value }))}
              />
              <span className="cd-per">/SF</span>
            </div>
          ))}
        </div>

        <FormField name="notes" id="co-notes" label="Notes">
          <textarea id="co-notes" className="fm-input cd-notes" value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />
        </FormField>
      </div>

      <footer className="cd-foot">
        <div className="cd-total">
          <span>{totals.slabs} slab{totals.slabs === 1 ? '' : 's'} · {formatSf(totals.sfHundredths)}</span>
          <span className="cd-total-amt">
            {totals.missingPrices && totals.missingPrices < totals.slabs ? 'Total so far ' : 'Total '}
            <b>{totals.missingPrices === totals.slabs ? '—' : formatMoney(totals.pricedCents)}</b>
          </span>
        </div>
        <div className="cd-foot-actions">
          <button type="button" className="fm-btn" onClick={onBack} disabled={saving}><ArrowLeft size={16} aria-hidden="true" />Back</button>
          <button type="button" className="fm-btn fm-btn-primary cd-grow" onClick={submit} disabled={saving} aria-busy={saving}>
            <Lock size={16} aria-hidden="true" />{saving ? 'Creating hold…' : 'Create Hold'}
          </button>
        </div>
      </footer>
    </>
  );
}

/**
 * "Added · Open cart", "Removed · Undo", "Hold #12 created · Open hold".
 * One on the page (placement "page", shown while the drawer is closed) and
 * one in the drawer's footer (placement "drawer", shown while it's open).
 */
export function CartToast({ onOpenHold, placement = 'page' }) {
  const { toast, open } = useCart();
  if (!toast || (placement === 'page') === open) return null;
  return (
    <div className={`cd-toast${open ? ' in-drawer' : ''}${toast.kind === 'error' ? ' is-error' : ''}`} role="status">
      {toast.kind === 'added' && <Check size={17} aria-hidden="true" className="cd-toast-ok" />}
      {toast.kind === 'error' && <AlertTriangle size={17} aria-hidden="true" />}
      <span className="cd-toast-text">{toast.text}</span>
      {toast.undo && <button type="button" className="cd-toast-btn gold" onClick={() => cartActions.undo(toast.undo)}>Undo</button>}
      {toast.kind === 'added' && !open && <button type="button" className="cd-toast-btn gold" onClick={() => { cartActions.dismissToast(); cartActions.open(); }}>Open cart</button>}
      {toast.kind === 'held' && onOpenHold && <button type="button" className="cd-toast-btn gold" onClick={() => { cartActions.dismissToast(); cartActions.close(); onOpenHold(toast.holdId); }}>Open hold</button>}
      <button type="button" className="cd-toast-x" onClick={() => cartActions.dismissToast()} aria-label="Dismiss"><X size={15} aria-hidden="true" /></button>
    </div>
  );
}

export default function CartDrawer({ user, onOpenHold }) {
  const { cart, open, expanded, view, loading, error } = useCart();
  const isPhone = useIsPhone();
  const { options: customers, loading: customersLoading } = useCustomerOptions();
  const [menuOpen, setMenuOpen] = useState(false);
  // Template pickers open their phone sheets here, above the drawer's footer (formLayer.js).
  const [layerEl, setLayerEl] = useState(null);
  const lines = useMemo(() => asLines(cart.lines), [cart.lines]);
  const [selected, setSelected] = useState(() => new Set());
  const seen = useRef(new Set());

  // New usable lines start ticked; lines that left the cart drop out.
  useEffect(() => {
    // Worked out before the update: the updater runs later, after `seen` moves on.
    const fresh = lines.filter((l) => usable(l) && !seen.current.has(l.slabKey)).map((l) => l.slabKey);
    seen.current = new Set(lines.map((l) => l.slabKey));
    setSelected((s) => {
      const next = new Set([...s].filter((k) => lines.some((l) => l.slabKey === k && usable(l))));
      fresh.forEach((k) => next.add(k));
      return next;
    });
  }, [lines]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !e.defaultPrevented) cartActions.close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  const chosen = lines.filter((l) => usable(l) && selected.has(l.slabKey));
  const chosenTotals = holdTotals(chosen);
  const canHold = can(user, HOLDS.CREATE);

  return createPortal(
    <div className="cd-layer">
      <div className="cd-scrim" onClick={() => cartActions.close()} aria-hidden="true" />
      <aside ref={setLayerEl} className={`cd fm-tokens${expanded && !isPhone ? ' is-expanded' : ''}`} role="dialog" aria-modal="true" aria-label={view === 'checkout' ? 'Create hold' : 'Cart'}>
        <FormLayerContext.Provider value={layerEl}>
        <header className="cd-head">
          <h2>{view === 'checkout' ? `Hold ${chosen.length} slab${chosen.length === 1 ? '' : 's'}` : 'Cart'}</h2>
          {view === 'cart' && !isPhone && (
            <button type="button" className="cd-icon" onClick={() => cartActions.setExpanded(!expanded)} aria-label={expanded ? 'Back to the drawer' : 'Expand cart to full width'} title={expanded ? 'Back to the drawer' : 'Expand'}>
              {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          )}
          {view === 'cart' && (
            <div className="cd-menu-wrap">
              <button type="button" className="cd-icon" onClick={() => setMenuOpen((o) => !o)} aria-haspopup="menu" aria-expanded={menuOpen} aria-label="More">
                <MoreHorizontal size={17} />
              </button>
              {menuOpen && (
                <div className="cd-menu" role="menu">
                  <button type="button" role="menuitem" disabled={!lines.length} onClick={() => { setMenuOpen(false); cartActions.clear(); }}>
                    <Trash2 size={15} aria-hidden="true" />Clear cart
                  </button>
                </div>
              )}
            </div>
          )}
          <button type="button" className="fm-close" onClick={() => cartActions.close()} aria-label="Close cart" title="Close (Esc)">
            <X size={18} strokeWidth={2.4} aria-hidden="true" />
          </button>
        </header>

        {view === 'checkout' ? (
          <CheckoutView
            user={user}
            cart={cart}
            chosen={chosen}
            customers={customers}
            customersLoading={customersLoading}
            onBack={() => cartActions.setView('cart')}
            onDone={(hold) => cartActions.held(hold)}
          />
        ) : (
          <>
            <div className="cd-body">
              {error && <div className="cd-banner" role="alert"><AlertTriangle size={16} aria-hidden="true" />{error}</div>}
              {loading && !lines.length ? <div className="cd-empty">Loading your cart…</div> : (
                <CartView
                  cart={cart}
                  lines={lines}
                  selected={selected}
                  setSelected={setSelected}
                  expanded={expanded && !isPhone}
                  customers={customers}
                  customersLoading={customersLoading}
                />
              )}
            </div>
            <footer className="cd-foot">
              <CartToast onOpenHold={onOpenHold} placement="drawer" />
              <div className="cd-total">
                <span><b>{chosen.length} of {lines.length} slab{lines.length === 1 ? '' : 's'}</b> · {formatSf(chosenTotals.sfHundredths)}</span>
                <span className="cd-hint">Prices are entered at checkout</span>
              </div>
              {canHold && (
                <div className="cd-foot-actions">
                  <button type="button" className="fm-btn fm-btn-primary cd-grow" disabled={!chosen.length} onClick={() => cartActions.setView('checkout')}>
                    <Lock size={16} aria-hidden="true" />Hold {chosen.length ? `${chosen.length} slab${chosen.length === 1 ? '' : 's'}` : ''}
                  </button>
                </div>
              )}
            </footer>
          </>
        )}
        </FormLayerContext.Provider>
      </aside>
    </div>,
    document.body
  );
}
