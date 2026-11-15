import { createHash } from 'node:crypto';
import type { Actor } from '../db/fuelman/index.ts';
import { newId } from '../db/ids.ts';
import type { ParsedReport } from './types.ts';
import { contentSignature } from './parseReport.ts';
import { digest } from './review.ts';
import { fleetTransaction, history } from './storage.ts';
import { HttpError } from './http.ts';
export async function importReport(parsed: ParsedReport, buffer: Buffer, filename: string, actor: Actor) {
  if (Buffer.byteLength(JSON.stringify(parsed)) > 8 * 1024 * 1024) throw new HttpError(400, 'This report exceeds the supported detail size');
  const scopeKey = digest(['fuelman', parsed.account, parsed.fleet]), periodKey = `${scopeKey}:${parsed.month}`;
  const fileHash = createHash('sha256').update(buffer).digest('hex'), contentHash = contentSignature(parsed);
  return fleetTransaction(scopeKey, async store => {
    const duplicate = await store.findDuplicate({ fileHash, scopeKey, contentHash });
    if (duplicate) return { id: duplicate.id, duplicate: true, month: duplicate.month };
    const revision = await store.latestRevision(periodKey) + 1;
    const report = await store.createReport(newId(), { scopeKey, periodKey, fileHash, contentHash, filename: filename.slice(0, 200), parsed,
      revision, status: 'draft', dispositions: [], overrides: [], importedAt: new Date(), importedBy: actor }, buffer);
    await store.ensurePeriod(periodKey, scopeKey, parsed.month);
    await history(report, actor, 'import', 'Imported original Fuelman report', { fileHash, totalCents: parsed.totalCents, revision: report.revision }, store);
    return { id: report._id, duplicate: false, month: parsed.month };
  });
}
