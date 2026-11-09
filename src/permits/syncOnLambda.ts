/**
 * What the Permits routes get as `sync` on Lambda (src/lambda/README.md).
 *
 * The pull runs on Render, which owns its "running" state in memory; a Lambda
 * instance never pulls (no `run`, so /refresh answers 503 — it isn't forwarded
 * anyway). /meta's `running` is read from the database instead: a source pull
 * still open (no finishedAt) and younger than a stale run. That misses the few
 * minutes after the last source while Render checks the county reports and the
 * contractor registry; the screen still waits on any source with no finishedAt,
 * and a Refresh pressed then gets "A pull is already running" from Render.
 */
import { PermitRun } from './models.ts';
import { STALE_RUN_MS } from './staleRun.ts';

export function permitSyncOnLambda(sync: { sourceIds: () => string[] }, now: () => Date = () => new Date()) {
  return {
    sourceIds: () => sync.sourceIds(),
    isRunning: async () => Boolean(await PermitRun.exists({ finishedAt: null, startedAt: { $gt: new Date(now().getTime() - STALE_RUN_MS) } }))
  };
}
