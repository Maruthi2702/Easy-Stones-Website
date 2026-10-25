import { createHash } from 'node:crypto';
interface ReportSale { _id: unknown; importedAt?: Date | string; product: string; uom: string; quantitySold: number; slabsSold: number }
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function reportIdentity(location: string, start: string, end: string, importedAt: string, records: ReportSale[]) {
  return {
    id: digest([location, start, end]),
    revision: digest(records.map(r => [String(r._id), r.importedAt, r.product, r.uom, r.quantitySold, r.slabsSold])),
    legacyId: digest([location, start, end, records.map(r => [String(r._id), r.importedAt, r.quantitySold, r.slabsSold])]),
  };
}
