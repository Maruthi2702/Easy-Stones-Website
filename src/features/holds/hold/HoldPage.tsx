import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, AlertTriangle, CheckCircle2, X, Loader2 } from 'lucide-react';
import { lotGroups, holdTotals, priceCentsOf, holdState } from '../../../holds/holdRules';
import { CART, can } from '../../../holds/permissions';
import { expiryLine, holdActions, cartSlabsFor } from '../../../utils/holdView';
import type { HoldLine } from '../types';
import type { OfferedSlab } from '../forms/HoldForms';
import type { CurrentUser } from '../../../types/records';
import { useCart, cartActions } from '../cartStore';
import { useMenu } from './useMenu';
import { useHoldRecord } from './useHoldRecord';
import { holdPageActions } from './holdPageActions';
import type { OpenForm, PageToast } from './holdPageActions';
import HoldHeader from './HoldHeader';
import HoldSummary from './HoldSummary';
import HoldSlabs from './HoldSlabs';
import type { LineGroup } from './HoldSlabs';
import HoldNotes from './HoldNotes';
import HoldHistory from './HoldHistory';
import type { HistoryEntry } from './HoldHistory';
import HoldSelectionBar from './HoldSelectionBar';
import HoldDialogs from './HoldDialogs';

export type HoldPageProps = { id: string; user: CurrentUser | null; sidebarToggle?: ReactNode; onBack: () => void };

/**
 * One hold (the canvas's "Hold page"): who it's for, until when, every slab
 * and its price, notes and the full history — with each change behind its own
 * permission (holdActions). Every save sends the version it was based on, so
 * a change made elsewhere in the meantime is refused, not overwritten.
 * Loading is useHoldRecord, the saves holdPageActions; the parts are below.
 */
export default function HoldPage({ id, user, sidebarToggle, onBack }: HoldPageProps) {
  const [pageTab, setPageTab] = useState('slabs');
  const [draft, setDraft] = useState<Record<string, string> | null>(null); // prices being edited: { [slabKey]: "22.00" }
  const [priceErrors, setPriceErrors] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [form, setForm] = useState<OpenForm | null>(null); // { type: 'details'|'extend'|'release'|'swap'|'add', line? }
  const [toast, setToast] = useState<PageToast | null>(null);
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);
  const moreMenu = useMenu();
  const { cart, loaded: cartLoaded, reservationsTick } = useCart();
  const { hold, setHold, error, reload } = useHoldRecord(id);

  // Someone else held or released slabs: catch up, unless a change is half-typed here.
  const [seenTick, setSeenTick] = useState(reservationsTick);
  if (seenTick !== reservationsTick && !draft && !form) {
    setSeenTick(reservationsTick);
    reload();
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
  const groups = lotGroups(hold.lines) as LineGroup[];
  const pricedLines: HoldLine[] = draft ? hold.lines.map((l: HoldLine) => ({ ...l, priceCentsPerSf: priceCentsOf(draft[l.slabKey] ?? '') ?? null })) : hold.lines;
  const totals = holdTotals(pricedLines);
  const offered = (act.slabs && canCart ? cartSlabsFor(hold, cart.lines) : []) as OfferedSlab[];
  const history: HistoryEntry[] | null = hold.history || null;
  const selectable = act.slabs && !draft;
  const allSelected = selected.size > 0 && selected.size === hold.lines.length;

  const {
    closeForm, formSave, toggle, toggleGroup, removeSelected, startPrices, setGroupPrice, savePrices
  } = holdPageActions({ hold, draft, selected, setHold, reload, setToast, setBusy, setForm, setSelected, setConfirmRemove, setDraft, setPriceErrors });

  return (
    <div className="hl-page hl-hold">
      <HoldHeader hold={hold} state={state} act={act} sidebarToggle={sidebarToggle} onBack={onBack} menuOpen={moreMenu.open} setMenuOpen={moreMenu.setOpen} menuRef={moreMenu.ref}
        onPrint={() => setPrinting(true)} onEdit={() => setForm({ type: 'details' })} onRelease={() => setForm({ type: 'release' })} />

      <HoldSummary hold={hold} state={state} exp={exp} act={act} now={now} onExtend={() => setForm({ type: 'extend' })} />

      <div className="hl-tabs" role="tablist" aria-label="Hold">
        <button type="button" role="tab" className="hl-tab" aria-selected={pageTab === 'slabs'} onClick={() => setPageTab('slabs')}>Slabs <span className="hl-cnt">{hold.lines.length}</span></button>
        <button type="button" role="tab" className="hl-tab" aria-selected={pageTab === 'notes'} onClick={() => setPageTab('notes')}>Notes</button>
        {history ? <button type="button" role="tab" className="hl-tab" aria-selected={pageTab === 'history'} onClick={() => setPageTab('history')}>History <span className="hl-cnt">{history.length}</span></button> : null}
      </div>

      {pageTab === 'slabs' ? (
        <HoldSlabs groups={groups} pricedLines={pricedLines} totals={totals} act={act} offered={offered} draft={draft} setDraft={setDraft}
          priceErrors={priceErrors} busy={busy} selected={selected} selectable={selectable} onAddFromCart={() => setForm({ type: 'add' })}
          startPrices={startPrices} onCancelPrices={() => { setDraft(null); setPriceErrors({}); }} savePrices={savePrices}
          toggle={toggle} toggleGroup={toggleGroup} setGroupPrice={setGroupPrice} onSwap={(line) => setForm({ type: 'swap', line })} />
      ) : null}

      {pageTab === 'notes' ? <HoldNotes hold={hold} canEdit={act.edit} onEdit={() => setForm({ type: 'details' })} /> : null}

      {pageTab === 'history' && history ? <section className="hl-sec"><HoldHistory entries={history} /></section> : null}

      {selected.size > 0 && !draft ? (
        <HoldSelectionBar holdNumber={hold.number} count={selected.size} allSelected={allSelected} canRelease={act.release}
          confirmRemove={confirmRemove} setConfirmRemove={setConfirmRemove} busy={busy} onClear={() => setSelected(new Set())} removeSelected={removeSelected} />
      ) : null}

      {toast ? (
        <div className={`hl-toast${toast.error ? ' error' : ''}`} role="status">
          {toast.error ? <AlertTriangle size={18} aria-hidden="true" /> : <CheckCircle2 size={18} className="ok" aria-hidden="true" />}
          <span>{toast.text}</span>
          <button type="button" className="hl-x" aria-label="Dismiss" onClick={() => setToast(null)}><X size={14} /></button>
        </div>
      ) : null}

      <HoldDialogs hold={hold} form={form} printing={printing} offered={offered} cartLines={cart.lines}
        closeForm={closeForm} closePrint={() => setPrinting(false)} formSave={formSave} />
    </div>
  );
}
