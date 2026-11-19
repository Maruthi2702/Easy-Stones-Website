import { deleteOlderThan } from '../db/locationPoints/index.ts';
import { retentionCutoff } from '../utils/locationTracking.ts';

/**
 * Location points are kept 90 days (src/utils/locationTracking.ts), then
 * deleted. Runs shortly after the server starts and then every 6 hours: cheap
 * (an indexed delete) and it means a restart never leaves old points around
 * for long. A failure is logged and tried again at the next run.
 */
export async function runLocationRetention(now: Date = new Date()): Promise<number> {
  try {
    const gone = await deleteOlderThan(retentionCutoff(now));
    if (gone) console.log(`🧹 Location tracking: deleted ${gone} point${gone === 1 ? '' : 's'} older than 90 days`);
    return gone;
  } catch (err) {
    console.error('Location retention failed:', err);
    return 0;
  }
}

export function startLocationRetention() {
  setTimeout(() => { void runLocationRetention(); }, 60 * 1000).unref();
  setInterval(() => { void runLocationRetention(); }, 6 * 60 * 60 * 1000).unref();
}
