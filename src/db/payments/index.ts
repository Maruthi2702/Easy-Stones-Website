/**
 * The Payments page's data layer: the route and the Daily Report read and write payments
 * through these, and each picks MongoDB or Postgres by the area's switch (`DB_PAYMENTS`,
 * src/db/appDb.ts). Both answer the same (payments.parity.test.ts).
 */
import { appDb, areaOn } from '../appDb.ts';
import * as mongo from './mongo.ts';
import * as pg from './postgres.ts';
import type { Loose } from '../../types/records.ts';
import type { PaymentHistoryEntry } from './types.ts';

export type { PaymentFigure, PaymentHistoryEntry } from './types.ts';

const onPostgres = () => areaOn('payments') === 'postgres';

export async function listPayments(locations: readonly string[], date: string) {
  return onPostgres() ? pg.listPayments(await appDb(), locations, date) : mongo.listPayments(locations, date);
}

export async function findPayment(id: string) {
  return onPostgres() ? pg.findPayment(await appDb(), id) : mongo.findPayment(id);
}

export async function paymentFigures(location: string, date: string, live = false) {
  return onPostgres() ? pg.paymentFigures(await appDb(), location, date, live) : mongo.paymentFigures(location, date, live);
}

export async function addPayment(id: string, location: string, value: Loose, by: string, at: Date) {
  return onPostgres() ? pg.addPayment(await appDb(), id, location, value, by, at) : mongo.addPayment(id, location, value, by, at);
}

export async function changePayment(id: string, set: Loose, entry: PaymentHistoryEntry) {
  return onPostgres() ? pg.changePayment(await appDb(), id, set, entry) : mongo.changePayment(id, set, entry);
}
