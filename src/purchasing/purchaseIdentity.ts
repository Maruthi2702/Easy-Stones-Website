import { variantKey } from './planning.ts';
import type { Receipt } from './types.ts';
export const transitParentIdentity = (po: string, product: string, branch: string, _supplier?: string) =>
  JSON.stringify([po, variantKey(product), branch]);
export function existingTransitParents(draft: { existingTransitParents?: string[]; inputSnapshot?: { receipts?: Receipt[] } }): Set<string> {
  const parents = new Set(draft.existingTransitParents || []);
  // Older drafts already kept source receipt keys. Retain their protection too.
  for (const receipt of draft.inputSnapshot?.receipts || []) {
    if (!receipt.key.startsWith('sps-transit:')) continue;
    try {
      const [po] = JSON.parse(receipt.key.slice('sps-transit:'.length));
      if (typeof po === 'string' && po) parents.add(transitParentIdentity(po, receipt.product, receipt.branch, receipt.supplier));
    } catch { /* a malformed legacy key cannot establish a PO identity */ }
  }
  return parents;
}
