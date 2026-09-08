/**
 * SPS's slab statuses, generalized into the four buckets the Inventory
 * Analysis UI colors (plus "other" for anything unrecognized, so a new/
 * unexpected SPS status code falls into a visible bucket instead of quietly
 * vanishing from every count).
 *
 * Shared by server.js (grouped/aggregated counts) and InventoryAnalysisTab.jsx
 * (per-slab rows, which carry the raw slabStatus string) so the two can't
 * silently drift apart on what a status code means — they used to be two
 * hand-copied implementations of the same four-line function.
 */
export const SLAB_STATUS_BUCKET = (rawStatus) => {
  if (!rawStatus) return 'available';
  if (rawStatus === 'ONHOLD') return 'hold';
  if (rawStatus === 'ONSO') return 'so';
  if (rawStatus === 'ONTRANSFER') return 'transfer';
  return 'other';
};
