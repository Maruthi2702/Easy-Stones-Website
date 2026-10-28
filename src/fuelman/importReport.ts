import { createHash } from 'node:crypto';
import { FuelReport, FuelSource, FuelPeriod } from './models.ts';
import type { Actor } from './models.ts';
import type { ParsedReport } from './types.ts';
import { contentSignature } from './parseReport.ts';
import { digest } from './review.ts';
import { fleetTransaction, history } from './storage.ts';
import { HttpError } from './http.ts';
export async function importReport(parsed: ParsedReport, buffer: Buffer, filename: string, actor: Actor) {
  if (Buffer.byteLength(JSON.stringify(parsed)) > 8 * 1024 * 1024) throw new HttpError(400, 'This report exceeds the supported detail size');
  const scopeKey = digest(['fuelman', parsed.account, parsed.fleet]), periodKey = `${scopeKey}:${parsed.month}`;
  const fileHash = createHash('sha256').update(buffer).digest('hex'), contentHash = contentSignature(parsed);
  return fleetTransaction(scopeKey, async session => {
    const duplicate = await FuelReport.findOne({ $or: [{ fileHash }, { scopeKey, contentHash }] }).session(session).lean();
    if (duplicate) return { id: String(duplicate._id), duplicate: true, month: duplicate.parsed.month };
    const previous = await FuelReport.findOne({ periodKey }).session(session).sort({ revision: -1 }).lean();
    const [report] = await FuelReport.create([{ scopeKey, periodKey, fileHash, contentHash, filename: filename.slice(0, 200), parsed,
      revision: (previous?.revision || 0) + 1, status: 'draft', dispositions: [], overrides: [], importedAt: new Date(), importedBy: actor }], { session });
    await FuelSource.create([{ reportId: report!._id, pdf: buffer }], { session });
    await FuelPeriod.updateOne({ _id: periodKey }, { $setOnInsert: { scopeKey, month: parsed.month, closed: false } }, { upsert: true, session });
    await history(report!, actor, 'import', 'Imported original Fuelman report', { fileHash, totalCents: parsed.totalCents, revision: report!.revision }, session);
    return { id: String(report!._id), duplicate: false, month: parsed.month };
  });
}
