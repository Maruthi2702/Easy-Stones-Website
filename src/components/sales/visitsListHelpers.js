/**
 * Pure helpers for the dashboard's Sales Visits list + detail view
 * (VisitsListDetail.jsx). No DOM, so they're tested in
 * visitsListHelpers.test.js.
 */

/**
 * Company and contact for a visit row. GET /api/dashboard/visits sends them
 * separately now (company, contactName); older responses only had the joined
 * customerName ("Bella's Flooring LLC - David Le/Bo"), split here on the first
 * " - " so the list still reads company-over-contact either way.
 */
export const splitCustomer = (visit = {}) => {
  const company = (visit.company || '').trim();
  const contact = (visit.contactName || '').trim();
  if (company || contact) {
    return { company: company || contact, contact: company ? contact : '' };
  }
  const joined = (visit.customerName || '').trim();
  const at = joined.indexOf(' - ');
  if (at === -1) return { company: joined || 'Unknown customer', contact: '' };
  return { company: joined.slice(0, at).trim(), contact: joined.slice(at + 3).trim() };
};
