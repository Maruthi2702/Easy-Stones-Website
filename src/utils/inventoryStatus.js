/**
 * SPS's slab statuses, generalized into the buckets the Inventory Analysis UI
 * colors (plus "other" for anything unrecognized, so a new/unexpected SPS
 * status code falls into a visible bucket instead of quietly vanishing from
 * every count).
 *
 * Shared by server.js (grouped/aggregated counts) and InventoryAnalysisTab.jsx
 * (per-slab rows, which carry the raw slabStatus string) so the two can't
 * silently drift apart on what a status code means — they used to be two
 * hand-copied implementations of the same four-line function.
 *
 * The raw values are normalized before matching because SPS is not internally
 * consistent about them: the live data carries "ONHOLD" and "ONTRANSFER" in
 * caps with no separator, but "Packinglist" in title case and "Pick Ticket"
 * with a space. Comparing on a stripped, upper-cased form means a future
 * export writing "PACKINGLIST" or "PickTicket" still lands in the right
 * bucket rather than silently falling through to "other".
 */
const normalize = (rawStatus) => String(rawStatus).toUpperCase().replace(/[^A-Z0-9]/g, '');

const BUCKET_BY_STATUS = {
  ONHOLD: 'hold',
  ONSO: 'so',
  ONTRANSFER: 'transfer',
  PICKTICKET: 'pickticket',
  PACKINGLIST: 'packinglist'
};

export const SLAB_STATUS_BUCKET = (rawStatus) => {
  if (!rawStatus) return 'available';
  return BUCKET_BY_STATUS[normalize(rawStatus)] || 'other';
};
