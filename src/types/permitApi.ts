/** JSON contracts exposed by /api/permits. Dates cross HTTP as ISO strings. */
export type PermitContact = {
  role: string; kind: string; company: string; name: string;
  phone: string; email: string; address: string; license?: string;
  customer?: { id: string; name: string };
  registry?: { matchedBy: 'license' | 'name'; license: string; businessName: string; phone: string; address: string; specialty: string; status: string; expiresOn: string | null };
};
export type PermitItem = {
  _id: string; source: string; permitNumber: string; category: string;
  type: string; subtype: string; status: string;
  appliedOn: string | null; issuedOn: string | null; finaledOn: string | null;
  address: string; city: string; zip: string; parcel: string;
  projectName: string; description: string; valuation: number | null;
  sqft: number | null; units: number | null; contacts: PermitContact[];
  detailsAt: string | null; sourceUrl: string; finalOnly: boolean; firstSeenAt: string;
};
export type PermitRunSummary = {
  kind: string; since: string; startedAt: string; finishedAt: string | null;
  ok: boolean; error: string; seen: number; leads: number; added: number;
  updated: number; detailErrors: number; latestIssuedOn: string | null;
  unsortedTypes?: { type?: string; count?: number }[]; by?: string;
};
export type PermitSource = {
  id: string; label: string; long: string; contactsNote?: string; issuer: string; county: string; countyLabel: string; kind: string; readsDetails: boolean; phones: boolean; siteLabel: string; checkHow: string; lookup?: { url: string; label: string; note: string }; lastRun: PermitRunSummary | null;
  lastOk: PermitRunSummary | null; coverageSince: string | null;
};
export type PermitCheck = {
  source: string; month: string; method: string; filled: number;
  addedFromReport: string[]; reportTitle: string; reportUrl: string;
  checkedAt: string; inReport: number; matched: number;
  missingFromApp: string[]; notInReport: string[]; inSearch: number;
  notFoundAgain: string[]; notInCountySearch: string[]; notIssuedYet: string[];
  datesMoved: string[]; notPublic: string[]; ok: boolean; error: string;
};
export type ContractorSummary = {
  license: string; businessName: string; phone: string; address: string;
  city: string; state: string; zip: string; licenseType: string;
  specialty: string; specialty2: string; status: string; expiresOn: string | null;
  principal: string; ubi: string; refreshedAt: string;
};
export type ContractorProfile = Partial<ContractorSummary> & {
  license: string; found: boolean; stale?: boolean; verifyUrl?: string;
  customer: { id: string; name: string } | null; emails: string[];
  insurance?: { company: string; policy: string; amount: number | null; effectiveOn: string | null; expiresOn: string | null; agency: string }[];
  bonds?: { company: string; account: string; amount: number | null; effectiveOn: string | null; expiresOn: string | null; untilCanceled: boolean }[];
  principals?: { name: string; since: string | null; until: string | null }[];
  permits: { total: number; byCategory: { category: string; label: string; count: number }[];
    recent: Pick<PermitItem, '_id' | 'source' | 'permitNumber' | 'category' | 'issuedOn' | 'address' | 'city' | 'valuation' | 'description'>[] };
};
