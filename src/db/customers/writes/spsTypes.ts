/** What the SPS run saves take and answer (sps.ts and its two twins). */
import type { Loose } from '../../../types/records.ts';

export interface NewRun {
  /** newId() from the route. */
  id: string;
  fileName: string;
  fingerprint: string;
  file: Buffer;
  createdBy: string;
  createdById: string;
  mapping: Loose;
  fileCheck: Loose;
  rowsRead: number;
}
export interface RunOutcome { result: string; reason?: string; createdId?: string }
export interface UndoOutcome {
  removed: number; reverted: number; deletedAgain: number; forgotten: number;
  failed: { key: string; name: string; reason: string }[];
}
