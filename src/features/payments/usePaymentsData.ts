import { useCallback, useEffect, useRef, useState } from 'react';
import { todayISO } from '../../components/shared/calendar/calendarDates';
import { homeLocationOf } from '../../utils/locationFilter';
import { newVisitId } from '../../utils/visitForm';
import * as api from './paymentsApi';
import type { PaymentBody } from './paymentsApi';
import type { Payment, PaymentDay, PaymentsUser } from './types';

const NO_DAY: PaymentDay = { submitted: false, submittedBy: '', submittedAt: null, autoSubmitted: false };

/**
 * The Payments page's data: which branches this login may pick, the branch
 * and day on screen, that day's payments and whether its Daily Report is
 * submitted (locked), and the branch's own today (no payment after it).
 * Answers for a branch or day no longer on screen are ignored.
 */
export function usePaymentsData(user: PaymentsUser | null) {
  const [locations, setLocations] = useState<string[]>([]);
  const [location, setLocation] = useState('');
  const [date, setDate] = useState(todayISO());
  const [today, setToday] = useState(todayISO());
  const [payments, setPayments] = useState<Payment[]>([]);
  const [day, setDay] = useState<PaymentDay>(NO_DAY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const asked = useRef('');

  useEffect(() => {
    let live = true;
    api.paymentLocations()
      .then(({ locations: list }) => {
        if (!live) return;
        setLocations(list);
        const home = homeLocationOf(user || {});
        setLocation(list.includes(home) ? home : list[0] || '');
        if (!list.length) { setLoading(false); setError('No branch is assigned to you. Ask an admin to add one in Users & Roles.'); }
      })
      .catch((e: Error) => { if (live) { setError(e.message); setLoading(false); } });
    return () => { live = false; };
    // The user's branches are read once per visit to the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async () => {
    if (!location) return;
    const key = `${location}|${date}`;
    asked.current = key;
    setLoading(true);
    setError('');
    try {
      const res = await api.listPayments(location, date);
      if (asked.current !== key) return;
      // The browser's today can be a day ahead of the branch's (Atlanta after
      // midnight looking at Seattle): step back to the branch's own today.
      if (res.today && date > res.today) { setToday(res.today); setDate(res.today); return; }
      setPayments(res.payments);
      setDay(res.day);
      setToday(res.today);
    } catch (e) {
      if (asked.current === key) setError((e as Error).message);
    } finally {
      if (asked.current === key) setLoading(false);
    }
  }, [location, date]);

  useEffect(() => { load(); }, [load]);

  /** Saves a new payment; it shows here only when it's for the day on screen. */
  const add = async (body: PaymentBody) => {
    const res = await api.addPayment(newVisitId(), location, body);
    if (res.payment.date === date) setPayments((list) => (list.some((p) => p.id === res.payment.id) ? list : [...list, res.payment]));
    return res.payment;
  };

  const edit = async (id: string, body: PaymentBody) => {
    const res = await api.editPayment(id, body);
    setPayments((list) => (res.payment.date === date
      ? list.map((p) => (p.id === id ? res.payment : p))
      : list.filter((p) => p.id !== id)));
    return res.payment;
  };

  const voidOne = async (id: string, reason: string) => {
    const res = await api.voidPayment(id, reason);
    setPayments((list) => list.map((p) => (p.id === id ? res.payment : p)));
    return res.payment;
  };

  return { locations, location, setLocation, date, setDate, today, payments, day, loading, error, reload: load, add, edit, voidOne };
}

export type PaymentsData = ReturnType<typeof usePaymentsData>;
