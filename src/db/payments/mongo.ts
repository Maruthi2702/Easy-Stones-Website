/** Payments received on MongoDB — the route's own Mongoose calls, moved here unchanged. */
import PaymentReceived from '../../models/PaymentReceived.ts';
import type { Loose } from '../../types/records.ts';
import type { PaymentFigure, PaymentHistoryEntry } from './types.ts';

/** A branch's (or several branches') payments for one day, oldest first. */
export async function listPayments(locations: readonly string[], date: string): Promise<Loose[]> {
  return PaymentReceived.find({ location: { $in: [...locations] }, date }).sort({ createdAt: 1, _id: 1 }).lean() as unknown as Promise<Loose[]>;
}

export async function findPayment(id: string): Promise<Loose | null> {
  return PaymentReceived.findById(id).lean() as unknown as Promise<Loose | null>;
}

/** Method, amount and void state of a branch's day (Daily Report totals; `live` leaves voided ones out). */
export async function paymentFigures(location: string, date: string, live: boolean): Promise<PaymentFigure[]> {
  const rows = await PaymentReceived.find(live ? { location, date, voidedAt: null } : { location, date }, 'method cents voidedAt').lean();
  return rows.map(r => ({ method: r.method, cents: r.cents, voidedAt: r.voidedAt ?? null }));
}

/** Add one payment; null when that id is already taken (a repeat of the same save). */
export async function addPayment(id: string, location: string, value: Loose, by: string, at: Date): Promise<Loose | null> {
  try {
    const saved = await PaymentReceived.create({
      _id: id, location, ...value, enteredBy: by, updatedBy: by, history: [{ at, by, action: 'added' }]
    });
    return saved.toObject() as unknown as Loose;
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return null;
    throw error;
  }
}

/** Change a payment (an edit or a void) and keep the line in its history; null if it is gone. */
export async function changePayment(id: string, set: Loose, entry: PaymentHistoryEntry): Promise<Loose | null> {
  const payment = await PaymentReceived.findById(id);
  if (!payment) return null;
  payment.set(set);
  payment.history.push(entry);
  await payment.save();
  return payment.toObject() as unknown as Loose;
}
