import { peekInventory, rememberInventory } from '../../api/inventoryAnalysisCache';
import type { Metadata, Plan, Draft, InboundRow } from '../../purchasing/types';

// Share inventory's import/sign-out invalidation, but retain the purchasing
// planner's shorter freshness window. Nothing is persisted to browser storage.
const prefix = 'purchasing:';
const MAX_AGE = 30_000;
let revision = 0;
interface Entry<T> { value: T; at: number; signal: number; revision: number }
export interface ScopeData { plan: Plan; drafts: Draft[]; inbound: InboundRow[] }
function read<T>(key: string, signal: number): T | undefined {
  const entry = peekInventory(prefix + key) as Entry<T> | undefined;
  if (!entry || entry.signal !== signal || entry.revision !== revision || Date.now() - entry.at >= MAX_AGE) return undefined;
  return entry.value;
}
function write<T>(key: string, value: T, signal: number) {
  rememberInventory(prefix + key, { value, at: Date.now(), signal, revision });
}
export const purchasingCache = {
  metadata: (signal: number) => read<Metadata>('metadata', signal),
  scope: (id: string, signal: number) => read<ScopeData>(`scope:${id}`, signal),
  saveMetadata: (value: Metadata, signal: number) => write('metadata', value, signal),
  saveScope: (id: string, value: ScopeData, signal: number) => write(`scope:${id}`, value, signal),
  selectedScope: () => peekInventory(prefix + 'selection') as string | undefined,
  selectScope: (id: string) => rememberInventory(prefix + 'selection', id),
  refreshIn: (id: string, signal: number) => {
    const entries = ['metadata', `scope:${id}`].map(key => peekInventory(prefix + key) as Entry<unknown> | undefined)
      .filter(entry => entry && entry.signal === signal && entry.revision === revision && Date.now() - entry.at < MAX_AGE);
    return Math.max(1, Math.min(MAX_AGE, ...entries.map(entry => MAX_AGE - (Date.now() - entry!.at))));
  },
  invalidate: () => { revision++; },
};
