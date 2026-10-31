import type { Loose } from '../../types/records.ts';
/**
 * City of Seattle — the city's "Building Permits" dataset on its open data
 * portal (data.seattle.gov, Socrata 76t5-zqzr), current to the day. The
 * dataset names a contractor company on few permits; each lead's public page
 * on the city's permit portal shows the contractor's WA license number, which
 * the state's L&I registry turns into a business name and phone
 * (src/permits/contractors.ts). Reader: src/permits/sources/seattle.ts.
 *
 * Seattle files a permit by the building's class (Single Family/Duplex,
 * Multifamily, Commercial…) and the kind of work (New, Addition/Alteration…).
 * Additions and remodels share one type, so both count as Remodel.
 */
import { key, typeMap, typeSet, cleanText, dayOf, tidyContacts, money, count } from '../common.ts';

export const SEATTLE_DATASET = 'https://data.seattle.gov/resource/76t5-zqzr.json';
/** A permit's page on the city's permit portal (the dataset's own `link`). */
export const seattlePermitPage = (permitNumber: string | number) => `https://services.seattle.gov/portal/customize/LinkToRecord.aspx?altId=${encodeURIComponent(permitNumber)}`;
export const SEATTLE_FIELDS = Object.freeze([
  'permitnum', 'permitclass', 'permitclassmapped', 'permittypemapped', 'permittypedesc', 'description',
  'housingunitsadded', 'estprojectcost', 'applieddate', 'issueddate', 'expiresdate', 'completeddate', 'statuscurrent',
  'originaladdress1', 'originalcity', 'originalzip', 'contractorcompanyname', 'link'
]);

/** permitclass | permittypedesc, among permittypemapped = 'Building'. ("Improvment" is Seattle's spelling.) */
const TYPES = typeMap([
  [['Single Family/Duplex', 'New'], 'new_home'],
  [['Single Family/Duplex', 'Addition/Alteration'], 'remodel'],
  [['Multifamily', 'New'], 'multifamily'],
  [['Multifamily', 'Addition/Alteration'], 'remodel'],
  [['Multifamily', 'Tenant Improvment'], 'commercial_remodel'],
  [['Commercial', 'New'], 'commercial_new'],
  [['Commercial', 'Addition/Alteration'], 'commercial_remodel'],
  [['Commercial', 'Tenant Improvment'], 'commercial_remodel'],
  [['Institutional', 'New'], 'commercial_new'],
  [['Institutional', 'Addition/Alteration'], 'commercial_remodel'],
  [['Institutional', 'Tenant Improvment'], 'commercial_remodel'],
  [['Industrial', 'New'], 'commercial_new'],
  [['Industrial', 'Addition/Alteration'], 'commercial_remodel'],
  [['Industrial', 'Tenant Improvment'], 'commercial_remodel']
]);

/** Building work that isn't a lead: temporary structures, paperwork-only changes of use. */
const SKIPPED_WORK = typeSet(['Temporary', 'Change of Use Only - No Construction']);
/** "Vacant Land" is the parcel's class, not what's being built — too unclear to call a lead. */
const SKIPPED_CLASSES = typeSet(['Vacant Land']);

const categoryFor = (cls: unknown, work = '') => TYPES.get(key(cls, work)) || null;

/** The contractor's license number on a permit's portal page ('' when the page names none). */
export function seattleLicense(html: unknown) {
  const text = String(html).replace(/<[^>]+>/g, '|').replace(/\s+/g, ' ');
  return text.match(/Contractor License:[\s|]*([A-Z0-9*]{6,15})\b/)?.[1] || '';
}

/**
 * A Seattle permit from one dataset row and (when read) its portal page's
 * `{ license }`. Without the page the contacts are left unset, so a save keeps
 * the ones read before.
 */
export function seattlePermit(row: Loose, detail: Loose | null = null) {
  return {
    source: 'seattle',
    permitNumber: cleanText(row.permitnum),
    externalId: '',
    category: categoryFor(row.permitclass, row.permittypedesc),
    type: cleanText(row.permitclass),
    subtype: cleanText(row.permittypedesc),
    status: cleanText(row.statuscurrent),
    appliedOn: dayOf(row.applieddate),
    issuedOn: dayOf(row.issueddate),
    finaledOn: dayOf(row.completeddate),
    expiresOn: dayOf(row.expiresdate),
    address: cleanText(row.originaladdress1),
    city: row.originalcity ? cleanText(row.originalcity).toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : 'Seattle',
    zip: cleanText(row.originalzip).slice(0, 5),
    parcel: '',
    projectName: '',
    description: cleanText(row.description),
    valuation: money(row.estprojectcost),
    sqft: null,
    units: count(row.housingunitsadded),
    contacts: detail ? tidyContacts([{ role: 'Contractor', company: row.contractorcompanyname, license: detail.license }]) : undefined,
    sourceUrl: cleanText(row.link?.url || row.link) || seattlePermitPage(cleanText(row.permitnum)),
    finalOnly: false
  };
}

export default {
  id: 'seattle',
  label: 'Seattle',
  long: 'City of Seattle',
  contactsNote: 'The contractor’s WA license number from each permit’s page; name and phone from the state’s contractor registry',
  issuer: 'City of Seattle permit',
  county: 'king',
  siteLabel: 'Open on Seattle’s permit site',
  checkHow: 'a separate count of the city’s data',
  detailConcurrency: 3,
  // A permit's page is read again once a week, not every morning.
  detailsFreshDays: 7,
  detailIdOf: (row: Loose) => cleanText(row.permitnum),
  typeOf: (row: Loose) => [row.permitclass, row.permittypedesc],
  categoryFor,
  isUnsorted: (cls: unknown, work = '') => !categoryFor(cls, work) && !SKIPPED_WORK.has(key(work)) && !SKIPPED_CLASSES.has(key(cls)),
  typeLabel: (cls: unknown, work = '') => [cls, work].filter(Boolean).join(' · '),
  issuedDayOf: (row: Loose) => dayOf(row.issueddate),
  numberOf: (row: Loose) => cleanText(row.permitnum),
  toPermit: (row: Loose, detail: Loose) => seattlePermit(row, detail),
  detailsError: (n: unknown) => `Seattle’s permit portal wouldn’t open any of the ${n} permits’ pages`,
  emptyError: (since: string) => `Seattle’s permit data has no building permits issued since ${since} — the city’s copy may have stopped updating`
};
