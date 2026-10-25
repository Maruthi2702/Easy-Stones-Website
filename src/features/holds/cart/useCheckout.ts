import { useEffect, useRef, useState } from 'react';
import { holdsMeta, createHold } from '../../../api/holds';
import {
  holdTotals, priceCentsOf, addDays, todayIn, daysBetween, DEFAULT_HOLD_DAYS
} from '../../../holds/holdRules';
import { HOLDS, can } from '../../../holds/permissions';
import { branchZone } from '../../../config/branches';
import type { Cart, Hold } from '../types';
import type { Id } from '../../../types/api';
import type { CurrentUser } from '../../../types/records';
import { groupsOf } from './cartLines';
import type { ShownLine } from './cartLines';

const newRequestId = (): string => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** GET /api/holds/meta. */
export type HoldsMeta = { scopes: string[]; branches: string[]; defaultBranch: string; defaultExpiresOn: string | null };

/**
 * The hold checkout's state (moved out of CartDrawer's CheckoutView,
 * 2026-10-24): customer, branch, hold-until, job, prices and notes; what's
 * missing; and Create Hold, sent once per checkout (requestId) so a double
 * tap or a retry never makes two holds.
 */
export function useCheckout({ user, cart, chosen, onDone }: { user: CurrentUser | null; cart: Cart; chosen: ShownLine[]; onDone: (hold: Hold) => void }) {
  const canExtend = can(user, HOLDS.EXTEND);
  const [meta, setMeta] = useState<HoldsMeta | null>(null);
  // The cart's customer unless one is picked here. Not copied at open: the cart's
  // customer is saved on the server first and can arrive after this window opens,
  // which used to open it empty and say "Pick the customer" for one already picked.
  const [pickedHere, setPickedHere] = useState<Id | null>(null);
  const customerId = pickedHere ?? (cart.customer?.id || '');
  const [branch, setBranch] = useState('');
  const [days, setDays] = useState<number | 'date'>(DEFAULT_HOLD_DAYS);
  const [customDate, setCustomDate] = useState('');
  const [job, setJob] = useState('');
  const [notes, setNotes] = useState('');
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [tried, setTried] = useState(false);
  const requestId = useRef(newRequestId());

  useEffect(() => {
    let live = true;
    holdsMeta().then((answer) => { const m = answer as HoldsMeta; if (live) { setMeta(m); setBranch((b) => b || m.defaultBranch); } }).catch((err) => live && setError(err.message));
    return () => { live = false; };
  }, []);

  const groups = groupsOf(chosen);
  const today = branch ? todayIn(branchZone(branch)) : null;
  const expiresOn = days === 'date' ? customDate : (today ? addDays(today, days) : '');
  const tooLong = expiresOn && today && daysBetween(today, expiresOn) > DEFAULT_HOLD_DAYS && !canExtend;
  const priceErrors = Object.fromEntries(Object.entries(prices).filter(([, v]) => priceCentsOf(v) === undefined).map(([k]) => [k, 'Enter the price like 12.50']));
  const priced = chosen.map((l) => ({ ...l, priceCentsPerSf: priceCentsOf(prices[l.product] ?? '') ?? null }));
  const totals = holdTotals(priced);
  const problems: Record<string, string> = {
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
      onDone(hold as Hold);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  const shown = (key: string) => (tried ? problems[key] : '');

  return {
    canExtend, meta, customerId, setPickedHere, branch, setBranch, days, setDays, customDate, setCustomDate, job, setJob,
    notes, setNotes, prices, setPrices, saving, error, tried, groups, today, priceErrors, totals, firstProblem, submit, shown
  };
}
