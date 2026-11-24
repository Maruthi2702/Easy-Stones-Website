import { useCallback, useEffect, useRef, useState } from 'react';
import { newVisitId } from '../../utils/visitForm';
import { CARD_RECEIPTS, can, monthOf } from '../../utils/cardReceipts';
import { isTodo } from './cardReceiptsView';
import * as api from './cardReceiptsApi';
import type { DetailsBody, ExpenseBody } from './cardReceiptsApi';
import { reasonOf } from './cardReceiptsView';
import type { Expense, Me, ReceiptsUser, RemindBody } from './types';

/**
 * Credit Card Receipts' data: who's signed in (their card, the categories,
 * their role), the month on screen and its expenses — every cardholder's with
 * View all, else their own — and what waits for them (any month): receipts
 * they approve, and questions asked of them. Answers for a month no longer on
 * screen are ignored.
 *
 * Every decision sends the `updatedAt` the screen saw; a 409 `changed` reloads
 * the lists so the receipt shows as it is now, and the error is thrown on for
 * the screen to show.
 */
export function useCardReceipts(user: ReceiptsUser | null) {
  const canAll = can(user, CARD_RECEIPTS.VIEW_ALL);
  // View branch sees the caller's team (the server decides who); both read the list as scope 'all'.
  const viewAll = canAll || can(user, CARD_RECEIPTS.VIEW_BRANCH);
  const teamOnly = viewAll && !canAll;
  const approver = can(user, CARD_RECEIPTS.APPROVE);
  const [me, setMe] = useState<Me | null>(null);
  const [month, setMonth] = useState('');
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [waiting, setWaiting] = useState<Expense[]>([]);
  // To do (review B1): the caller's own Missing receipt / Draft / Sent back from every month, not only the one on screen.
  const [todo, setTodo] = useState<Expense[]>([]);
  const [holders, setHolders] = useState<{ id: string; name: string; active: boolean }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [waitingError, setWaitingError] = useState('');
  const asked = useRef('');

  useEffect(() => {
    let live = true;
    api.loadMe()
      .then((res) => { if (live) { setMe(res); setMonth(monthOf(res.today)); } })
      .catch((e: Error) => { if (live) { setError(e.message); setLoading(false); } });
    return () => { live = false; };
  }, []);

  // Everyone with a card in view, for the Cardholder filter (not only who has an expense this month).
  useEffect(() => {
    if (!viewAll) return undefined;
    let live = true;
    api.listCardholders().then((r) => { if (live) setHolders(r.holders); }).catch(() => { /* the filter falls back to who has expenses */ });
    return () => { live = false; };
  }, [viewAll]);

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

  // Waiting for me: approvers' receipts, and questions asked of anyone (a manager without Approve may be
  // asked too), so everyone asks once; only an approver is told when it fails.
  const loadWaiting = useCallback(async () => {
    setWaitingError('');
    try { setWaiting((await api.listExpenses('waiting', '')).expenses); } catch (e) {
      if (approver) setWaitingError((e as Error).message || 'Couldn’t load the receipts waiting for you.');
    }
  }, [approver]);
  useEffect(() => { loadWaiting(); }, [loadWaiting]);

  const loadTodo = useCallback(async () => {
    if (!can(user, CARD_RECEIPTS.USE)) return;
    try { setTodo((await api.listExpenses('todo', '')).expenses || []); } catch { /* the month's own list still shows them */ }
  }, [user]);
  useEffect(() => { loadTodo(); }, [loadTodo]);

  const reload = useCallback(() => { load(); loadWaiting(); loadTodo(); }, [load, loadWaiting, loadTodo]);

  /** Puts a saved expense in place everywhere it shows. */
  const place = (e: Expense) => {
    setExpenses((list) => {
      // Someone else's expense (approved from Waiting for me) joins the list only with View all.
      const inMonth = monthOf(e.date) === month && (canAll || e.mine || list.some((x) => x.id === e.id));
      const without = list.filter((x) => x.id !== e.id);
      return inMonth ? [e, ...without].sort((a, b) => b.date.localeCompare(a.date)) : without;
    });
    setTodo((list) => {
      const still = e.mine && !e.voided && isTodo(e);
      const without = list.filter((x) => x.id !== e.id);
      return still ? [e, ...without].sort((a, b) => b.date.localeCompare(a.date)) : without;
    });
    setWaiting((list) => {
      const mine = e.status === 'waiting' && !e.voided && reasonOf(e) !== null;
      if (!mine) return list.filter((x) => x.id !== e.id);
      return list.some((x) => x.id === e.id) ? list.map((x) => (x.id === e.id ? e : x)) : [e, ...list];
    });
  };

  /** A write: the answer is put in place; a 409 `changed` reloads, so the screen shows the receipt as it is now. */
  const run = async (fn: () => Promise<{ expense: Expense }>) => {
    try {
      const r = await fn();
      place(r.expense);
      return r.expense;
    } catch (e) {
      if (api.isChanged(e)) reload();
      throw e;
    }
  };

  /** It answered a bank charge: that charge's Missing receipt row is gone (voided on the server). */
  const dropMissing = (id?: string) => {
    if (!id) return;
    setExpenses((list) => list.filter((x) => x.id !== id));
    setTodo((list) => list.filter((x) => x.id !== id));
  };
  const add = async (body: ExpenseBody) => {
    const r = await api.addExpense(newVisitId(), body);
    dropMissing(r.replacedMissing);
    place(r.expense);
    return r.expense;
  };
  // A corrected day or total may answer a charge too (the server looks again).
  const edit = (id: string, body: ExpenseBody) => run(async () => { const r = await api.editExpense(id, body); dropMissing(r.replacedMissing); return r; });
  /** "This is my receipt" on a Missing receipt row (review B2): the row goes, the receipt shows as the server left it. */
  const matchToCharge = (missing: Expense, receiptId: string) => run(async () => { const r = await api.matchReceiptToCharge(missing.id, receiptId); dropMissing(r.replacedMissing); return r; });
  const approve = (e: Expense, comment: string) => run(() => api.approveExpense(e.id, comment, e.updatedAt));
  const sendBack = (e: Expense, comment: string) => run(() => api.sendBackExpense(e.id, comment, e.updatedAt));
  const ask = (e: Expense, to: string, question: string) => run(() => api.askAboutExpense(e.id, to, question, e.updatedAt));
  const withdrawAsk = (e: Expense) => run(() => api.withdrawAsk(e.id, e.updatedAt));
  const answer = (e: Expense, text: string) => run(() => api.answerAsk(e.id, text, e.updatedAt));
  const reopen = (e: Expense, reason: string) => run(() => api.reopenExpense(e.id, reason, e.updatedAt));
  const fillDetails = (e: Expense, body: DetailsBody) => run(() => api.fillExpenseDetails(e.id, body, e.updatedAt));
  const voidOne = (e: Expense, reason: string) => run(() => api.voidExpense(e.id, reason, e.updatedAt));
  /** Send reminder…: the server's summary; the lists reload so "Reminded today" shows. */
  const remind = async (body: RemindBody) => {
    const r = await api.remindExpenses(body);
    reload();
    return r;
  };

  return {
    me, month, setMonth, expenses, waiting, todo, waitingError, holders, loading: loading || !me, error, viewAll, teamOnly, approver,
    reload, add, edit, matchToCharge, nearReceipts: api.nearReceipts, approve, sendBack, ask, withdrawAsk, answer, reopen, fillDetails, voidOne, remind,
    askTargets: api.askTargets, upload: api.uploadReceipt, scan: api.scanReceipt
  };
}

export type CardReceiptsData = ReturnType<typeof useCardReceipts>;
