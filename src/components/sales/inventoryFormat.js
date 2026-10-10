/**
 * Number formats and status labels the Inventory screen and its slab list
 * share (moved out of InventoryAnalysisTab.jsx, 2026-10-10, when the slab
 * list became its own component).
 */

export const fmtMoney = (n) => `$${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
export const fmtNum = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 1 });
// Rates keep their cents, unlike the whole-dollar extended amounts: a lot
// priced at $12.94/SF vs $13/SF is a real difference once it's multiplied by
// a few hundred feet, and this figure exists to be quoted from directly.
export const fmtRate = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const ageDays = (dateStr) => {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
};

// Matches SLAB_STATUS_BUCKET (src/utils/inventoryStatus.js), which
// generalizes SPS's raw slabStatus strings into these four buckets (plus
// "other" for anything unrecognized) so the UI never has to special-case
// SPS's literal codes.
// Ordered roughly by how far along the outbound path a slab is — available,
// then spoken for, then being staged to leave, then gone — so the proportional
// status bar reads left-to-right as progress rather than an arbitrary order.
export const STATUS_ORDER = ['available', 'hold', 'so', 'pickticket', 'packinglist', 'transfer', 'other'];
export const STATUS_LABEL = {
  available: 'Available',
  hold: 'Hold',
  so: 'On SO',
  pickticket: 'Pick Ticket',
  packinglist: 'Packing List',
  transfer: 'Transfer',
  other: 'Other'
};

export const dominantStatus = (counts) => {
  const present = STATUS_ORDER.filter(k => counts[k] > 0);
  if (!present.length) return null;
  return present.reduce((best, k) => (counts[k] > counts[best] ? k : best), present[0]);
};
