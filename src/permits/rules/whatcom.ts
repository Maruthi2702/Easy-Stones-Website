import type { Loose } from '../../types/records.ts';
/**
 * Whatcom County (unincorporated areas) — Tyler EnerGov self-service, the
 * same search the county's own site runs. Contacts (GC, owner, applicant)
 * come with phone and email. Reader: src/permits/sources/whatcom.ts.
 * Checked monthly against the county's "Permits Issued" PDF (countyReport.js).
 */
import { key, typeMap, typeSet, cleanText, dayOf, tidyContacts, money, count } from '../common.ts';

export const WHATCOM_PORTAL = 'https://whatcomcountywa-energovweb.tylerhost.net/apps/selfservice';
export const whatcomPermitUrl = (caseId: string | number) => `${WHATCOM_PORTAL}#/permit/${encodeURIComponent(caseId)}`;

/** EnerGov's CaseType, which already includes the work class. */
const TYPES = typeMap([
  ['Building (Residential) - SFR - New Construction', 'new_home'],
  ['Building (Residential) - SFR - Modular Home/Foundation Only', 'new_home'],
  ['Building (Residential) - Detached - New Construction', 'adu'],
  ['Building (Residential) - SFR - Addition', 'addition'],
  ['Building (Residential) - Detached - Addition', 'addition'],
  ['Building (Residential) - SFR - Alteration, Remodel, Repair', 'remodel'],
  ['Building (Residential) - Detached - Alteration/Remodel/Repair', 'remodel'],
  ['Building (Commercial) - Multi-Family - New', 'multifamily'],
  ['Building (Commercial) - New', 'commercial_new'],
  ['Building (Commercial) - Alteration/Tenant Improvement', 'commercial_remodel'],
  ['Building (Commercial) - Addition', 'commercial_remodel']
]);

/** Building types that are deliberately not leads. */
const SKIPPED = typeSet([
  'Building - Land Clearing Permit',
  'Building (Residential) - Demolition',
  'Building (Residential) - Window Replacement',
  'Building (Residential) - Re-Roof',
  'Building (Residential) - Re-Side',
  'Building (Residential) - Foundation',
  'Building (Residential) - Relocation',
  'Building (Residential) - Detached - Relocation',
  'Building (Residential) - Detached - Agricultural Building',
  'Building (Commercial) - Eligible Facility Request',
  'Building (Commercial) - Certificate of Occupancy',
  'Building (Commercial) - Complex',
  'Mobile/Manufactured Home Structure - Manufactured Home'
]);

/**
 * An EnerGov permit from its search row and (when fetched) its detail record.
 * The detail adds valuation, square feet, the full description and contacts.
 * `rule` names the source (Whatcom and Renton both run EnerGov).
 */
export function energovPermit(rule: Loose, row: Loose, detail: Loose | null = null) {
  const a = row.Address || {};
  const contacts = detail ? (detail.Contacts || []).map((c: string) => ({
    role: c.ContactTypeName,
    company: c.GlobalEntityName,
    name: [c.FirstName, c.LastName].map(cleanText).filter(Boolean).join(' '),
    phone: c.Phone,
    email: c.EmailTo,
    address: c.MainAddress
  })) : null;
  return {
    source: rule.id,
    permitNumber: cleanText(row.CaseNumber),
    externalId: cleanText(row.CaseId),
    category: rule.categoryFor(...rule.typeOf(row)),
    type: cleanText(row.CaseType),
    subtype: cleanText(row.CaseWorkclass),
    status: cleanText(row.CaseStatus),
    appliedOn: dayOf(row.ApplyDate),
    issuedOn: dayOf(row.IssueDate),
    finaledOn: dayOf(row.FinalDate),
    expiresOn: dayOf(row.ExpireDate),
    address: cleanText([a.AddressLine1, a.PreDirection, a.AddressLine2, a.StreetTypeName, a.PostDirection, a.UnitOrSuite && `#${a.UnitOrSuite}`].filter(Boolean).join(' ').replace(/\s*#\s*$/, '')) || cleanText(row.AddressDisplay),
    city: cleanText(a.City),
    zip: cleanText(a.PostalCode),
    parcel: cleanText(row.MainParcel),
    projectName: cleanText(row.ProjectName),
    description: cleanText(detail?.Description || row.Description),
    valuation: detail ? money(detail.ValuationValue) : undefined,
    sqft: detail ? count(detail.SquareFeet) : undefined,
    units: undefined,
    contacts: contacts ? tidyContacts(contacts) : undefined,
    sourceUrl: row.CaseId && rule.permitUrl ? rule.permitUrl(row.CaseId) : '',
    finalOnly: false
  };
}

const whatcom = {
  id: 'whatcom',
  label: 'Whatcom County',
  long: 'Whatcom County (outside city limits)',
  contactsNote: 'GC, owner and applicant with phone and email',
  issuer: 'Whatcom County permit',
  county: 'whatcom',
  kind: 'county',
  // Contacts come with their own phone and email.
  phones: true,
  siteLabel: 'Open on the county’s permit site',
  checkHow: 'a separate county search by permit number',
  detailConcurrency: 4,
  permitUrl: whatcomPermitUrl,
  typeOf: (row: Loose) => [row.CaseType],
  categoryFor: (type: string) => TYPES.get(key(type)) || null,
  isUnsorted: (type: string) => /^(Building|Mobile\/Manufactured)/i.test(String(type || '').trim()) && !SKIPPED.has(key(type)),
  typeLabel: (type: string) => String(type || ''),
  issuedDayOf: (row: Loose) => dayOf(row.IssueDate),
  numberOf: (row: Loose) => cleanText(row.CaseNumber),
  detailIdOf: (row: Loose) => row.CaseId,
  toPermit: (row: Loose, detail: Loose) => energovPermit(whatcom, row, detail),
  // The county issues permits every working day; an empty window means the
  // search answered wrongly, not that nothing happened.
  emptyError: (since: string, total: unknown) => `Whatcom County returned no permits issued since ${since} (it reported ${total ?? 'no'} records in all)`,
  detailsError: (n: unknown) => `Whatcom County wouldn’t open any of the ${n} permits’ details`
};

export default whatcom;
