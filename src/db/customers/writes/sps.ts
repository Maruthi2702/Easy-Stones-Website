/**
 * The SPS import runs (drafts, the frozen plan, the writer, the check, Undo): MongoDB or
 * Postgres by the area's switch. The routes and the runner call these, never the twins.
 * See ./README.md. Each is the code that used to sit in src/routes/customerSpsImport.ts /
 * src/services/spsImportRunner.ts; what stays there is the control flow.
 */
import { appDb, areaOn } from '../../appDb.ts';
import * as mongo from './sps.mongo.ts';
import * as pg from './sps.postgres.ts';
import type { Loose } from '../../../types/records.ts';
import type { NewRun, RunOutcome } from './spsTypes.ts';

export type { NewRun, RunOutcome, UndoOutcome } from './spsTypes.ts';

const onPostgres = () => areaOn('customers') === 'postgres';

export async function spsCreateRun(r: NewRun) {
  return onPostgres() ? pg.createRun(await appDb(), r) : mongo.createRun(r);
}

export async function spsCurrentRuns(who: string) {
  return onPostgres() ? pg.currentRuns(await appDb(), who) : mongo.currentRuns(who);
}

export async function spsRunHistory() {
  return onPostgres() ? pg.runHistory(await appDb()) : mongo.runHistory();
}

export async function spsGetRun(id: string) {
  return onPostgres() ? pg.getRun(await appDb(), id) : mongo.getRun(id);
}

export async function spsGetRunFile(id: string) {
  return onPostgres() ? pg.getRunFile(await appDb(), id) : mongo.getRunFile(id);
}

export async function spsFailedItems(runId: string) {
  return onPostgres() ? pg.failedItems(await appDb(), runId) : mongo.failedItems(runId);
}

export async function spsDeleteDraft(id: string) {
  return onPostgres() ? pg.deleteDraft(await appDb(), id) : mongo.deleteDraft(id);
}

export async function spsSaveRunAnswers(id: string, set: Loose) {
  return onPostgres() ? pg.saveRunAnswers(await appDb(), id, set) : mongo.saveRunAnswers(id, set);
}

export async function spsFindRunning() {
  return onPostgres() ? pg.findRunning(await appDb()) : mongo.findRunning();
}

export async function spsFindDraft(id: string) {
  return onPostgres() ? pg.findDraft(await appDb(), id) : mongo.findDraft(id);
}

export async function spsFindFinished(id: string) {
  return onPostgres() ? pg.findFinished(await appDb(), id) : mongo.findFinished(id);
}

export async function spsClaimRun(id: string, set: Loose) {
  return onPostgres() ? pg.claimRun(await appDb(), id, set) : mongo.claimRun(id, set);
}

export async function spsReportItems(runId: string) {
  return onPostgres() ? pg.reportItems(await appDb(), runId) : mongo.reportItems(runId);
}

export async function spsItemsPage(runId: string, result: string, page: number, limit: number) {
  return onPostgres() ? pg.itemsPage(await appDb(), runId, result, page, limit) : mongo.itemsPage(runId, result, page, limit);
}

export async function spsCustomerIdsOf(runId: string, results: string[]) {
  return onPostgres() ? pg.customerIdsOf(await appDb(), runId, results) : mongo.customerIdsOf(runId, results);
}

export async function spsDeletedBackups() {
  return onPostgres() ? pg.deletedBackups(await appDb()) : mongo.deletedBackups();
}

export async function spsFreezeRun(run: Loose, items: Loose[], runSet: Loose) {
  return onPostgres() ? pg.freezeRun(await appDb(), run, items, runSet) : mongo.freezeRun(run, items, runSet);
}

export async function spsStarterOf(runId: string) {
  return onPostgres() ? pg.starterOf(await appDb(), runId) : mongo.starterOf(runId);
}

export async function spsPendingBatch(runId: string, limit: number) {
  return onPostgres() ? pg.pendingBatch(await appDb(), runId, limit) : mongo.pendingBatch(runId, limit);
}

export async function spsRecordItem(item: Loose, runId: string, out: RunOutcome) {
  return onPostgres() ? pg.recordItem(await appDb(), item, runId, out) : mongo.recordItem(item, runId, out);
}

export async function spsFailedCount(runId: string) {
  return onPostgres() ? pg.failedCount(await appDb(), runId) : mongo.failedCount(runId);
}

export async function spsRequeueFailed(runId: string, failed: number, opts: { running?: boolean } = {}) {
  return onPostgres() ? pg.requeueFailed(await appDb(), runId, failed, opts) : mongo.requeueFailed(runId, failed, opts);
}

export async function spsMarkRunFailed(runId: string, error: string) {
  return onPostgres() ? pg.markRunFailed(await appDb(), runId, error) : mongo.markRunFailed(runId, error);
}

export async function spsRunningRunIds() {
  return onPostgres() ? pg.runningRunIds(await appDb()) : mongo.runningRunIds();
}

export async function spsFinishRun(runId: string, verify: Loose) {
  return onPostgres() ? pg.finishRun(await appDb(), runId, verify) : mongo.finishRun(runId, verify);
}

export async function spsCheckRun(runId: string) {
  return onPostgres() ? pg.checkRun(await appDb(), runId) : mongo.checkRun(runId);
}

export async function spsWriteItem(item: Loose, runId: string, createdBy?: string) {
  return onPostgres() ? pg.writeItem(await appDb(), item, runId, createdBy) : mongo.writeItem(item, runId, createdBy);
}

export async function spsUndoRun(runId: string, by = '') {
  return onPostgres() ? pg.undoRun(await appDb(), runId, by) : mongo.undoRun(runId, by);
}
