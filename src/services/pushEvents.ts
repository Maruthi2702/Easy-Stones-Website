import type { Loose } from '../types/records.ts';
import * as staffData from '../db/staff/index.ts';
import { sendPushToUsers } from './apns.ts';
import {
  type Message, checkInMessage, checkInRecipients, driverAssignedMessage, driverChanged, driverUserFor,
  receiptSentBackMessage, reportRecipients, reportSubmittedMessage
} from '../utils/pushEvents.ts';

/**
 * The push events (rules and words: src/utils/pushEvents.ts). Every function here is fire-and-forget:
 * push is a nicety, never part of a save, so nothing throws and callers don't wait on Apple.
 */
const STAFF_FIELDS = 'username displayName email role isActive location assignedLocations';

type Send = (userIds: string[], m: Message) => Promise<unknown>;
const staff = async () => (await staffData.findUsers({}, { select: STAFF_FIELDS })) as Loose[];
const run = (label: string, job: () => Promise<unknown>) => { void job().catch(e => console.error(`Push (${label}):`, (e as Error)?.message || e)); };

export function pushReceiptSentBack(expense: Loose, comment: unknown, send: Send = sendPushToUsers) {
  run('receipt sent back', async () => { if (expense?.userId) await send([String(expense.userId)], receiptSentBackMessage(expense, comment)); });
}

export function pushDriverAssigned(before: unknown, delivery: Loose, send: Send = sendPushToUsers) {
  if (!driverChanged(before, delivery?.truckId) || delivery?.status === 'cancelled') return;
  run('driver assigned', async () => {
    const driver = driverUserFor(delivery.truckId, await staff());
    if (driver) await send([String(driver._id)], driverAssignedMessage(delivery));
  });
}

export function pushReportSubmitted(report: Loose, send: Send = sendPushToUsers) {
  run('report submitted', async () => {
    const location = await staffData.locationByName(String(report.location ?? ''));
    const ids = reportRecipients(location?.dailyReportEmail?.userIds, await staff());
    if (ids.length) await send(ids, reportSubmittedMessage(report));
  });
}

export function pushCheckIn(checkIn: Loose, send: Send = sendPushToUsers) {
  run('check-in', async () => {
    const ids = checkInRecipients(checkIn, await staff());
    if (ids.length) await send(ids, checkInMessage(checkIn));
  });
}
