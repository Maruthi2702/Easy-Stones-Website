// Tacoma: how the city's open-data layer becomes leads (real records trimmed
// from the layer, 2026-10-22), and the reader's query and count check.
import { describe, it, expect } from 'vitest';
import tacoma, { tacomaPermit } from './rules/tacoma.js';
import { createTacomaSource, tacomaWhere } from './sources/tacoma.js';
import { RULES, SOURCES, categoryFor, isUnsortedBuildingType } from './permitRules.js';

const noSleep = async () => {};
const json = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });

const NEW_HOME = {
  objectid: 102960, permit_number: 'BLDRN25-0306', permit_type: 'Building', permit_subtype: 'Residential', permit_category: 'New Building',
  current_status: 'Permit Issued', application_date: Date.UTC(2025, 10, 11), issued_date: Date.UTC(2026, 9, 19),
  applicant_name: 'WC STUDIO ARCHITECTURE AGENCY', address_line_1: '820 N UNION AVE', zip: '98406', parcel_number: '2545100011',
  description: 'NEW CONSTRUCTION THREE-STORY HOUSEPLEX WITH 6 DWELLING UNITS.', valuation: 787362, housing_units: 6,
  link: 'https://aca-prod.accela.com/TACOMA/urlrouting.ashx?type=1000&amp;Module=Permits&amp;capID1=DUB25&amp;agencyCode=TACOMA'
};

describe('Tacoma rules', () => {
  it('is in Pierce County, as a city', () => {
    expect(RULES.tacoma).toBe(tacoma);
    expect(SOURCES.tacoma).toMatchObject({ county: 'pierce', kind: 'city' });
  });

  it('copies a new building as the city sent it', () => {
    expect(tacomaPermit(NEW_HOME)).toMatchObject({
      source: 'tacoma', permitNumber: 'BLDRN25-0306', externalId: '102960', category: 'new_home', type: 'Residential', subtype: 'New Building',
      status: 'Permit Issued', appliedOn: '2025-11-11', issuedOn: '2026-10-19', address: '820 N UNION AVE', city: 'Tacoma', zip: '98406',
      valuation: 787362, units: 6, finalOnly: false,
      sourceUrl: 'https://aca-prod.accela.com/TACOMA/urlrouting.ashx?type=1000&Module=Permits&capID1=DUB25&agencyCode=TACOMA'
    });
    expect(tacomaPermit(NEW_HOME).contacts).toMatchObject([{ role: 'Applicant', company: 'WC STUDIO ARCHITECTURE AGENCY' }]);
  });

  it('files broad alterations as Other building and skips trades and demolitions', () => {
    expect(categoryFor('tacoma', 'Residential', 'New Building')).toBe('new_home');
    expect(categoryFor('tacoma', 'Commercial', 'New Building')).toBe('commercial_new');
    expect(categoryFor('tacoma', 'Residential', 'Alteration')).toBe('building_other');
    expect(categoryFor('tacoma', 'Commercial', 'Alteration')).toBe('building_other');
    for (const [t, s] of [['Residential', 'Mechanical'], ['Residential', 'Plumbing'], ['Commercial', 'Fire Protection'], ['Residential', 'Demolition'], ['Mechanical', 'NA']]) {
      expect(categoryFor('tacoma', t, s)).toBeNull();
      expect(isUnsortedBuildingType('tacoma', t, s)).toBe(false);
    }
  });

  it('reports a building type nobody has sorted', () => {
    expect(isUnsortedBuildingType('tacoma', 'Residential', 'Solar Thing')).toBe(true);
    expect(isUnsortedBuildingType('tacoma', 'Residential', 'Alteration')).toBe(false);
  });
});

describe('Tacoma reader', () => {
  it('asks only for building permits issued since the start, and refuses a short answer', async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      const p = new URL(url).searchParams;
      calls.push(Object.fromEntries(p));
      if (p.get('returnCountOnly') === 'true') return json({ count: 3 });
      return json({ features: [{ attributes: { objectid: 1 } }, { attributes: { objectid: 2 } }] });
    };
    await expect(createTacomaSource({ fetchImpl, sleep: noSleep }).issuedSince('2026-10-01')).rejects.toThrow(/said 3 permits but sent 2/);
    expect(calls[0].where).toBe("issued_date >= DATE '2026-10-01' AND permit_type = 'Building'");
    expect(calls[1].orderByFields).toBe('objectid');
    expect(() => tacomaWhere("2026-10-01' OR 1=1 --")).toThrow();
  });
});
