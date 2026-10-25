import { describe, it, expect } from 'vitest';
import { categoryFor, isUnsortedBuildingType, RULES, SOURCES, sourcesInCounties } from './permitRules.js';
import { createEnergovSource } from './sources/energov.js';
import { createPermitReaders } from './readers.js';

const cat = (t) => categoryFor('skagit_county', t);

describe('Skagit County', () => {
  it('files the county’s exact building types', () => {
    expect(cat('Single Family Residence')).toBe('new_home');
    expect(cat('Modular Building')).toBe('new_home');
    expect(cat('Accessory Dwelling Unit')).toBe('adu');
    expect(cat('Residential Addition')).toBe('addition');
    expect(cat('Residential Alteration')).toBe('remodel');
    expect(cat('Residential Duplex/Townhouse')).toBe('multifamily');
    expect(cat('Commercial New Building')).toBe('commercial_new');
    expect(cat('Commercial Alteration')).toBe('commercial_remodel');
    expect(cat('Commercial Addition')).toBe('commercial_remodel');
  });

  it('skips outbuildings, manufactured homes, trades and non-building permits without reporting them', () => {
    for (const t of ['Residential Accessory Building', 'Residential Accessory Structures', 'Commercial Accessory Buildings', 'Residential Manufactured Home',
      'Demolition Permit', 'Residential Mechanical', 'Residential Water Heater Replacement', 'Commercial Fire Alarm Systems', 'Commercial Sign',
      'Residential Gate Installation', 'Commercial Gate Installation',
      'Septic System (New or Redesign)', 'Residential Burn Permit', 'Floodplain Permit', 'Public Works - Utility Permit', 'Residential Access Permit',
      'Land Disturbance Activity Permit', '(Water Systems Evaluation) Individual Well', 'Firework Stands']) {
      expect(cat(t), t).toBeNull();
      expect(isUnsortedBuildingType('skagit_county', t), t).toBe(false);
    }
  });

  it('reports a building type nobody has sorted, and ignores the county’s stray leading space', () => {
    expect(isUnsortedBuildingType('skagit_county', 'Residential Pool')).toBe(true);
    expect(isUnsortedBuildingType('skagit_county', 'Commercial Tower')).toBe(true);
    expect(cat(' Single Family Residence')).toBe('new_home');
  });

  it('is its own county, listed before Snohomish', () => {
    expect(SOURCES.skagit_county).toMatchObject({ county: 'skagit', kind: 'county', readsDetails: true, phones: true });
    expect(sourcesInCounties(['skagit'])).toEqual(['skagit_county', 'anacortes']);
    expect(Object.keys(createPermitReaders())).toContain('skagit_county');
  });

  it('copies a search row and its detail, contractor phone and email included', () => {
    const row = {
      CaseId: 'abc', CaseNumber: 'BLDR-2026-0031', CaseType: 'Single Family Residence', CaseWorkclass: 'Single Family Residence', CaseStatus: 'Issued',
      IssueDate: '2026-10-19T09:00:00', MainParcel: 'P64865',
      Address: { AddressLine1: '15903', AddressLine2: 'YOKEKO', StreetTypeName: 'DRIVE', PreDirection: '', PostDirection: '', UnitOrSuite: '', City: 'ANACORTES', PostalCode: '98221' }
    };
    const detail = {
      PermitNumber: 'BLDR-2026-0031', Description: 'Building a single family residence', ValuationValue: 450000, SquareFeet: 2806,
      Contacts: [{ ContactTypeName: 'General Contractor', GlobalEntityName: 'VALLEY CONSTRUCTION   ', FirstName: 'Lester', LastName: 'Francis', Phone: '(360) 333-3371', EmailTo: 'valconlf@hotmail.com', MainAddress: 'P O BOX 201 SEDRO WOOLLEY WA \r\n98284' },
        { ContactTypeName: 'Applicant', FirstName: 'Jordan', LastName: 'Small', Phone: '(000) 000-0000', EmailTo: 'jordan@example.com' }]
    };
    const p = RULES.skagit_county.toPermit(row, detail);
    expect(p).toMatchObject({
      source: 'skagit_county', permitNumber: 'BLDR-2026-0031', category: 'new_home', issuedOn: '2026-10-19', address: '15903 YOKEKO DRIVE', city: 'ANACORTES',
      zip: '98221', valuation: 450000, sqft: 2806, parcel: 'P64865',
      sourceUrl: 'https://skagitcountywa-energovweb.tylerhost.net/apps/selfservice#/permit/abc'
    });
    expect(p.contacts).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Lester Francis', phone: expect.stringContaining('333-3371'), email: 'valconlf@hotmail.com' })]));
    expect(p.contacts.find((c) => c.name === 'Jordan Small').phone).toBe('');
  });
});

describe('Skagit County reader', () => {
  const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
  const row = (n, issued) => ({ CaseId: n, CaseNumber: n, CaseType: 'Single Family Residence', IssueDate: issued });

  function server(pages) {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push(init.headers?.['Tyler-TenantUrl']);
      if (url.endsWith('/api/energov/search/criteria')) return json({ Success: true, Result: { PermitCriteria: {} } });
      const page = JSON.parse(init.body).PageNumber;
      return json({ Success: true, Result: { TotalFound: 99, EntityResults: pages[page - 1] || [] } });
    };
    return { fetchImpl, calls };
  }

  it('reads newest-issued first until the issue dates fall before the window, asking as the county’s tenant', async () => {
    const { fetchImpl, calls } = server([[row('A', '2026-10-20T10:00:00'), row('B', '2026-10-19T10:00:00')], [row('C', '2026-10-01T10:00:00'), row('D', '2026-09-01T10:00:00')], [row('E', '2026-08-01T10:00:00')]]);
    const src = createEnergovSource({ name: 'Skagit County', tenant: 'skagitcountywa', base: 'https://x.test/apps/selfservice', fetchImpl, sleep: async () => {} });
    const { rows, pages } = await src.issuedSince('2026-10-01');
    expect(rows.map((r) => r.CaseId)).toEqual(['A', 'B', 'C']);
    expect(pages).toBe(2);
    expect(new Set(calls.filter(Boolean))).toEqual(new Set(['skagitcountywa']));
  });

  it('copes with the county’s one future-dated record at the top of the list', async () => {
    const { fetchImpl } = server([[row('FUTURE', '2028-05-22T10:13:40'), row('A', '2026-10-20T10:00:00')], [row('Z', '2026-01-01T00:00:00')]]);
    const src = createEnergovSource({ name: 'Skagit County', tenant: 'skagitcountywa', base: 'https://x.test/apps/selfservice', fetchImpl, sleep: async () => {} });
    const { rows } = await src.issuedSince('2026-10-01');
    expect(rows.map((r) => r.CaseId)).toEqual(['FUTURE', 'A']);
  });
});
