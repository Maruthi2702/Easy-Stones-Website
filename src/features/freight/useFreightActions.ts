import { useEffect, useState } from 'react';
import { formatCents } from '../../accounting/money';
import { plural } from './freightView';
import * as api from './freightApi';
import type { Loose } from '../../types/records';
import type { FreightActions, FreightForm, FreightPanel, FreightToast } from './types';

/**
 * What the page's buttons do: which side panel and which form are open, the
 * toast, and the one-click actions (approve, send back, mark reviewed, an
 * invoice's approve / send back) — each refreshes the list and clears the
 * selection when it lands. Paying always goes through a form (PayForm), and
 * `done` is what a form calls once its save has landed. The server checks
 * every action again.
 */
export function useFreightActions({ refresh, setError, clearSelection }: {
  refresh: () => void; setError: (message: string) => void; clearSelection: () => void;
}) {
  const [panel, setPanel] = useState<FreightPanel | null>(null); // { type: 'charge'|'invoice'|'payment'|'carriers', id }
  const [form, setForm] = useState<FreightForm | null>(null);
  const [toast, setToast] = useState<FreightToast | null>(null); // { text, paymentId }
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), toast.paymentId ? 12000 : 6000);
    return () => clearTimeout(t);
  }, [toast]);

  // ── Actions (the server checks each one again) ──
  const run = async (fn: () => Promise<Loose>, message?: FreightToast | ((r: Loose) => FreightToast)) => {
    setBusy(true);
    setError('');
    try {
      const r = await fn();
      clearSelection();
      refresh();
      if (message) {
        const m = typeof message === 'function' ? message(r) : message;
        setToast(typeof m === 'string' ? { text: m } : m);
      }
      return r;
    } catch (err) {
      setError((err as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const act: FreightActions = {
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
  const done = (message?: FreightToast) => { setForm(null); clearSelection(); refresh(); if (message) setToast(message); };

  return { panel, setPanel, form, setForm, toast, setToast, busy, act, closeForm, done };
}

/** The toast after a payment: what was paid, the amount, and its PAY- id (a replayed request says so). */
export const paidToast = (r: Loose, what: string): FreightToast => ({
  text: `${r.replayed ? 'Already paid — ' : 'Paid '}${what} · ${formatCents(r.payment?.totalCents ?? r.totalCents)}`,
  paymentId: r.payment?.paymentId
});
