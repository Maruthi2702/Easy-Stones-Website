// Shared by LostSaleModal (the form) and LostSalesTab (the list and its
// filters), so the two can never disagree about a reason's label or how a
// customer reference — sometimes a string, sometimes a populated record —
// resolves to a name.

export const REASON_OPTIONS = [
  { id: 'Out of Stock', label: 'Out of Stock', filterLabel: 'Out of Stock', badgeClass: 'badge-out-of-stock' },
  { id: 'Price Too High', label: 'Price Too High / Competitor', filterLabel: 'Price Too High', badgeClass: 'badge-price-high' },
  { id: 'Lead Time', label: 'Lead Time / Delivery Delay', filterLabel: 'Lead Time', badgeClass: 'badge-lead-time' },
  { id: 'Color / Pattern Match', label: 'Color / Pattern Match Issue', filterLabel: 'Color Match', badgeClass: 'badge-color-match' },
  { id: 'Quality / Spec Issue', label: 'Quality / Defect Concern', filterLabel: 'Quality Issue', badgeClass: 'badge-quality-issue' },
  { id: 'Competitor Discount', label: 'Competitor Discount', filterLabel: 'Competitor', badgeClass: 'badge-competitor' },
  { id: 'Customer Cancelled', label: 'Customer Cancelled Project', filterLabel: 'Cancelled', badgeClass: 'badge-cancelled' },
  { id: 'Other', label: 'Other Reason', filterLabel: 'Other', badgeClass: 'badge-other-reason' }
];

export const getCustomerName = (c, fallback = 'Unknown Customer') => {
  if (!c) return fallback;
  if (typeof c === 'string') return c;
  if (typeof c === 'object') {
    const fullName = `${c.firstName || ''} ${c.lastName || ''}`.trim();
    return c.company || c.contactName || (fullName.length > 0 ? fullName : null) || c.name || c.fabricatorCompany || fallback;
  }
  return String(c);
};
