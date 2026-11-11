/** What the import saves take and answer (imports.ts and its two twins). */
import type { Loose } from '../../../types/records.ts';

export interface ConnectInput {
  connect: { customerId: string; key: string }[];
  /** Customers to mark "not in SPS". */
  notInSps: string[];
  /** The SPS name each key stands for. */
  nameByKey: Record<string, string>;
  by: string;
  now: Date;
}
export interface ConnectResult {
  connected: number;
  notInSps: number;
  failed: { customerId: string; reason: string }[];
}

/** One planned update: the customer's id and the dotted-path `$set` the plan made. */
export interface ImportUpdate { targetId: string; apply: Loose }

/** A save of the import's remembered answers: dotted keys like `repAliases.<key>` → value. */
export interface MemorySave {
  set: Record<string, string>;
  by: string;
  /** newId() from the caller, used only when the memory is first made. */
  id: string;
}
export interface ImportMemoryRecord {
  repAliases: Record<string, string>;
  branchAliases: Record<string, string>;
  decisions: Record<string, string>;
}
