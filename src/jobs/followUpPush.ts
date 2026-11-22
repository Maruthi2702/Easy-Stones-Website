import type { Loose } from '../types/records.ts';
import * as staffData from '../db/staff/index.ts';
import { usersWithDevices } from '../db/pushDevices/index.ts';
import { dueOnDay } from '../db/followUpDue/index.ts';
import { sendPushToUsers } from '../services/apns.ts';
import { followUpClock, followUpsDueMessage } from '../utils/pushEvents.ts';

/**
 * One push a morning to each person with the app who has follow-ups due that day (owner's list, 2026-11-21):
 * checked every 15 minutes, and a person is sent theirs in the 8 o'clock hour on their own branch's clock.
 * "Sent today" is kept in memory, so a server restart inside that hour can send it twice — acceptable for a
 * reminder, and nothing is sent when none are due.
 */
const sent = new Set<string>();

export async function runFollowUpPush(now: Date = new Date()): Promise<number> {
  let pushed = 0;
  try {
    const ids = await usersWithDevices();
    if (!ids.length) return 0;
    const people = (await staffData.findUsers({ _id: { $in: ids } }, { select: 'location assignedLocations isActive' })) as Loose[];
    for (const person of people) {
      if (person.isActive === false) continue;
      const { today, isPushHour } = followUpClock(person.location || (person.assignedLocations || [])[0], now);
      const key = `${today}:${person._id}`;
      if (!isPushHour || sent.has(key)) continue;
      sent.add(key);
      const due = await dueOnDay(String(person._id), today);
      if (due > 0) { await sendPushToUsers([String(person._id)], followUpsDueMessage(due)); pushed++; }
    }
    if (sent.size > 5000) sent.clear();
  } catch (err) {
    console.error('Follow-up push failed:', (err as Error).message);
  }
  return pushed;
}

export function startFollowUpPush() {
  setTimeout(() => { void runFollowUpPush(); }, 90 * 1000).unref();
  setInterval(() => { void runFollowUpPush(); }, 15 * 60 * 1000).unref();
}
