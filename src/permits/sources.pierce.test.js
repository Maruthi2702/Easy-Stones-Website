// Pierce County: how its layer's records become leads (real records trimmed
// from the county's layer, 2026-10-22), and the reader's query and count check.
import { describe, it, expect } from 'vitest';
import pierceCounty, { piercePermit, pacificDay } from './rules/pierceCounty.js';
import { createPierceCountySource, pierceWhere } from './sources/pierceCounty.js';
import { RULES, categoryFor, isUnsortedBuildingType } from './permitRules.js';

const noSleep = async () => {};
const json = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });

const NEW_HOME = {
  OBJECTID: 11, applicationNumber: 1025243, applicationType: 'Construction Residential', applicationStatus: 'Issued',
  workType: 'New Structure', buildingType: 'House/plex', dwellingUnits: '1', sqFtTotal: 2602, buildingValuation: 244082.33,
  issuedDate: 1791817875000, siteAddress: '5857 116TH STCT E', parcelNumber: '6027690230', projectName: "Molly's Court, Lot 23",
  workDescription: 'Construct 2-story 4-bdrm single family residence\nBase Plan #1022414',
  urlOnlinePermits: 'https://pals.piercecountywa.gov/palsonline/permitSearch/permit/departmentStatus?applPermitId=1025243'
};
const cat = (type, work, building) => categoryFor('pierce_county', type, `${work} · ${building}`);

describe('Pierce County rules', () => {
  it('is listed under its county, with no contacts', () => {
    expect(RULES.pierce_county).toBe(pierceCounty);
    expect(pierceCounty.county).toBe('pierce');
  });

  it('copies a new home as the county sent it', () => {
    expect(piercePermit(NEW_HOME)).toMatchObject({
      source: 'pierce_county', permitNumber: '1025243', externalId: '11', category: 'new_home',
      type: 'Construction Residential', subtype: 'New Structure · House/plex', status: 'Issued', issuedOn: '2026-10-12',
      address: '5857 116TH STCT E', city: '', parcel: '6027690230', valuation: 244082.33, sqft: 2602, units: 1, contacts: [],
      projectName: "Molly's Court, Lot 23", sourceUrl: NEW_HOME.urlOnlinePermits, finalOnly: false
    });
  });

  it('sorts the lead types', () => {
    expect(cat('Construction Residential', 'Addition', 'House/plex')).toBe('addition');
    expect(cat('Construction Residential', 'Remodel', 'House/plex')).toBe('remodel');
    expect(cat('Construction Residential', 'Remodel', 'Adult Family Home')).toBe('remodel');
    expect(cat('Construction Commercial', 'New Structure', 'Townhouse')).toBe('multifamily');
    expect(cat('Construction Commercial', 'New Structure', 'Townhouse - Residential')).toBe('multifamily');
    expect(cat('Construction Commercial', 'New Structure', 'Office')).toBe('commercial_new');
    expect(cat('Construction Commercial', 'Tenant Improvement', 'Restaurant')).toBe('commercial_remodel');
    expect(cat('Construction Commercial', 'Remodel', 'Apartment')).toBe('commercial_remodel');
  });

  it('skips outbuildings, towers, walls and demolitions without reporting them', () => {
    for (const [t, w, b] of [
      ['Construction Residential', 'New Structure', 'Garage'], ['Construction Residential', 'New Structure', 'Deck/Dock/Shed'],
      ['Construction Residential', 'New Structure', 'Swimming Pool'], ['Construction Residential', 'New Structure', 'Agriculture'],
      ['Construction Residential', 'Demolition', 'House/plex'], ['Construction Commercial', 'Remodel', 'Cell Tower'],
      ['Construction Commercial', 'New Structure', 'Bulkhead/Retaining Wall']
    ]) {
      expect(cat(t, w, b), `${w} ${b}`).toBeNull();
      expect(isUnsortedBuildingType('pierce_county', t, `${w} · ${b}`)).toBe(false);
    }
  });

  it('reports a building type nobody has sorted, and ignores non-building permits', () => {
    expect(isUnsortedBuildingType('pierce_county', 'Construction Residential', 'Replacement Permit · House/plex')).toBe(true);
    expect(isUnsortedBuildingType('pierce_county', 'Mechanical', '')).toBe(false);
    expect(isUnsortedBuildingType('pierce_county', 'Construction Residential', 'Remodel · House/plex')).toBe(false);
  });

  it('reads a late-evening issue on the county’s Pacific day', () => {
    expect(pacificDay(Date.parse('2026-10-12T17:30:00-07:00'))).toBe('2026-10-12');
    expect(pacificDay(null)).toBeNull();
  });
});

describe('Pierce County reader', () => {
  it('asks only for building permits issued since the start, and refuses a short answer', async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      const p = new URL(url).searchParams;
      calls.push(Object.fromEntries(p));
      if (p.get('returnCountOnly') === 'true') return json({ count: 3 });
      return json({ features: [{ attributes: { OBJECTID: 1 } }, { attributes: { OBJECTID: 2 } }] });
    };
    await expect(createPierceCountySource({ fetchImpl, sleep: noSleep }).issuedSince('2026-10-01')).rejects.toThrow(/said 3 permits but sent 2/);
    expect(calls[0].where).toBe(pierceWhere('2026-10-01'));
    expect(pierceWhere('2026-10-01')).toBe("issuedDate >= DATE '2026-10-01' AND applicationDept = '*BUILDING*' AND applicationType IN ('Construction Residential', 'Construction Commercial')");
    expect(() => pierceWhere("2026-10-01' OR 1=1 --")).toThrow();
  });
});
