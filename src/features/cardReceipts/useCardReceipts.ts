import { useCallback, useEffect, useRef, useState } from 'react';
import { newVisitId } from '../../utils/visitForm';
import { CARD_RECEIPTS, can, monthOf } from '../../utils/cardReceipts';
import * as api from './cardReceiptsApi';
import type { ExpenseBody } from './cardReceiptsApi';
import type { Expense, Me, ReceiptsUser } from './types';

/**
 * Credit Card Receipts' data: who's signed in (their card, the categories,
 * whose receipts they approve), the month on screen and its expenses — every
 * cardholder's with View all, else their own — and what waits for their
 * approval (any month). Answers for a month no longer on screen are ignored.
 */
export function useCardReceipts(user: ReceiptsUser | null) {
  const viewAll = can(user, CARD_RECEIPTS.VIEW_ALL);
  const approver = can(user, CARD_RECEIPTS.APPROVE);
  const [me, setMe] = useState<Me | null>(null);
  const [month, setMonth] = useState('');
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [waiting, setWaiting] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const asked = useRef('');

  useEffect(() => {
    let live = true;
    api.loadMe()
      .then((res) => { if (live) { setMe(res); setMonth(monthOf(res.today)); } })
      .catch((e: Error) => { if (live) { setError(e.message); setLoading(false); } });
    return () => { live = false; };
  }, []);

  const scope = viewAll ? 'all' : 'mine';
  const load = useCallback(async () => {
    if (!month) return;
    const key = `${scope}|${month}`;
    asked.current = key;
    setLoading(true);
    setError('');
    try {
      const res = await api.listExpenses(scope, month);
      if (asked.current === key) setExpenses(res.expenses);
    } catch (e) {
      if (asked.current === key) setError((e as Error).message);
    } finally {
      if (asked.current === key) setLoading(false);
    }
  }, [scope, month]);
  useEffect(() => { load(); }, [load]);

  const loadWaiting = useCallback(async () => {
    if (!approver) return;
    try { setWaiting((await api.listExpenses('waiting', '')).expenses); } catch { /* the Expenses list shows the error */ }
  }, [approver]);
  useEffect(() => { loadWaiting(); }, [loadWaiting]);

  /** Puts a saved expense in place everywhere it shows. */
  const place = (e: Expense) => {
    setExpenses((list) => {
      // Someone else's expense (approved from Waiting for me) joins the list only with View all.
      const inMonth = monthOf(e.date) === month && (viewAll || e.mine);
      const without = list.filter((x) => x.id !== e.id);
      return inMonth ? [e, ...without].sort((a, b) => b.date.localeCompare(a.date)) : without;
    });
    setWaiting((list) => (e.status === 'waiting' && e.canDecide
      ? list.map((x) => (x.id === e.id ? e : x))
      : list.filter((x) => x.id !== e.id)));
  };

  const add = async (body: ExpenseBody) => { const r = await api.addExpense(newVisitId(), body); place(r.expense); return r.expense; };
  const edit = async (id: string, body: ExpenseBody) => { const r = await api.editExpense(id, body); place(r.expense); return r.expense; };
  const approve = async (id: string, comment: string) => { const r = await api.approveExpense(id, comment); place(r.expense); return r.expense; };
  const sendBack = async (id: string, comment: string) => { const r = await api.sendBackExpense(id, comment); place(r.expense); return r.expense; };
  const voidOne = async (id: string, reason: string) => { const r = await api.voidExpense(id, reason); place(r.expense); return r.expense; };

  return {
    me, month, setMonth, expenses, waiting, loading: loading || !me, error, viewAll, approver,
    reload: () => { load(); loadWaiting(); }, add, edit, approve, sendBack, voidOne, upload: api.uploadReceipt
  };
}

export type CardReceiptsData = ReturnType<typeof useCardReceipts>;
