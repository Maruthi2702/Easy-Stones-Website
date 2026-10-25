import type { Dispatch, SetStateAction } from 'react';
import { changeHoldSlabs, setHoldPrices } from '../../../api/holds';
import { priceDraftOf, priceChanges, slabCount } from '../../../utils/holdView';
import type { Hold, HoldLine } from '../types';
import type { LineGroup } from './HoldSlabs';

/** Which form is open over the page. */
export type OpenForm = { type: 'details' | 'extend' | 'release' | 'add' } | { type: 'swap'; line: HoldLine };

/** The toast at the bottom of the page. */
export type PageToast = { text: string; error?: boolean };

/** Wraps a form's save: run it, then close the form (a refusal stays in the form). */
export type FormSave = <A extends unknown[]>(fn: (...args: A) => Promise<unknown>, message: string | ((saved: Hold) => string)) => (...args: A) => Promise<void>;

type Setter<T> = Dispatch<SetStateAction<T>>;

type HoldPageState = {
  hold: Hold;
  draft: Record<string, string> | null;
  selected: Set<string>;
  setHold: Setter<Hold | null>;
  reload: () => void;
  setToast: Setter<PageToast | null>;
  setBusy: Setter<boolean>;
  setForm: Setter<OpenForm | null>;
  setSelected: Setter<Set<string>>;
  setConfirmRemove: Setter<boolean>;
  setDraft: Setter<Record<string, string> | null>;
  setPriceErrors: Setter<Record<string, string>>;
};

/**
 * The hold page's changes (moved out of HoldPage, 2026-10-24): every save
 * goes through `run`, which shows the saved hold, reloads its history and
 * says what happened — a form shows its own error, elsewhere the toast does,
 * and a 409 (changed elsewhere) reloads. Plus the slab ticks and the price
 * editor. Built each render from the page's state, like the handlers were.
 */
export function holdPageActions({
  hold, draft, selected, setHold, reload, setToast, setBusy, setForm, setSelected, setConfirmRemove, setDraft, setPriceErrors
}: HoldPageState) {
  /** Run a change; the page shows the saved hold and reloads its history. */
  // A form shows its own error (it rethrows); elsewhere the toast does.
  const run = async (fn: () => Promise<unknown>, message: string | ((saved: Hold) => string) | null, { inForm = false }: { inForm?: boolean } = {}): Promise<Hold> => {
    setBusy(true);
    try {
      const saved = await fn() as Hold;
      setHold((prev) => ({ ...saved, history: prev?.history }));
      reload();
      if (message) setToast({ text: typeof message === 'function' ? message(saved) : message });
      return saved;
    } catch (err) {
      if (!inForm) setToast({ text: (err as Error).message, error: true });
      if ((err as { status?: number }).status === 409) reload();
      throw err;
    } finally {
      setBusy(false);
    }
  };
  const closeForm = () => setForm(null);
  const formSave: FormSave = (fn, message) => async (...args) => { await run(() => fn(...args), message, { inForm: true }); setForm(null); };

  const toggle = (key: string) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const toggleGroup = (g: LineGroup) => setSelected((s) => {
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
  const setGroupPrice = (g: LineGroup, value: string) => setDraft((d) => ({ ...d, ...Object.fromEntries(g.lines.map((l) => [l.slabKey, value])) }));
  const savePrices = async () => {
    const { changed, errors } = priceChanges(hold.lines, draft as Record<string, string>);
    setPriceErrors(errors);
    if (Object.keys(errors).length) return;
    if (!changed.length) { setDraft(null); return; }
    try {
      await run(() => setHoldPrices(hold, changed), `Prices saved for ${slabCount(changed.length)}`);
      setDraft(null);
    } catch { /* toast shows why; the draft stays */ }
  };

  return { run, closeForm, formSave, toggle, toggleGroup, removeSelected, startPrices, setGroupPrice, savePrices };
}
