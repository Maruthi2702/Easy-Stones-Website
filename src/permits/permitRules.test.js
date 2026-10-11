import { describe, it, expect } from 'vitest';
import {
  categoryFor, isUnsortedBuildingType, dayOf, shiftDay, pacificNow, isDailyRunDue, runSince, phoneKey, formatPhone,
  emailKey, nameKey, tidyContacts, isPlaceholderName, isFinalOnly, whatcomPermit, bellinghamPermit, reportMonthOf,
  reportPermitNumbers, reconcileReport, compareMonthToDate, permitPrefix, monthBounds, fullMonthsBetween, whatcomPermitUrl
} from './permitRules.js';

// Trimmed from real answers, 2026-10-11.
const WHATCOM_ROW = {
  CaseId: 'b040c9fa-1ee6-4853-b2b5-d0f79638936c', CaseNumber: 'SFR2026-00212',
  CaseType: 'Building (Residential) - SFR - New Construction', CaseWorkclass: 'New Construction', CaseStatus: 'Issued',
  ProjectName: '', IssueDate: '2026-10-06T00:00:00', ApplyDate: '2026-05-18T15:17:28', ExpireDate: null, FinalDate: null,
  Address: { AddressLine1: '2996', AddressLine2: 'BROOK', StreetTypeName: 'LN', PreDirection: '', PostDirection: '', UnitOrSuite: '', City: 'Sedro Woolley', PostalCode: '98284' },
  AddressDisplay: '2996 BROOK LN Sedro Woolley WA 98284', MainParcel: '3704292102230000', Description: ''
};
const WHATCOM_DETAIL = {
  PermitNumber: 'SFR2026-00212',
  Description: 'New, w/ lu, SFR with associated driveway and septic system. 3 Bed, 3 Bath, TotalSF=2845',
  ValuationValue: 307360.0, SquareFeet: 2808.0,
  Contacts: [
    { ContactTypeName: 'Applicant', GlobalEntityName: 'Larry Stoner Land Development Consultants', FirstName: 'JESSE', LastName: 'STONER', EmailTo: 'jesse@larrystoner.net', Phone: '3602200552', MainAddress: '4340 PACIFIC HWY Unit: 202 \r\nBellingham, WA 98226' },
    { ContactTypeName: 'Contractor - GC', GlobalEntityName: 'KVF Construction', FirstName: 'Vladimir', LastName: 'Kolesnikov', EmailTo: 'kvf1616@gmail.com', Phone: '3607397535', MainAddress: '5630 CAMDEN LN Ferndale, WA 98248' },
    { ContactTypeName: 'Owner', GlobalEntityName: 'KVF Construction', FirstName: 'Vladimir', LastName: 'Kolesnikov', EmailTo: 'kvf1616@gmail.com', Phone: '3607397535', MainAddress: '5630 CAMDEN LN Ferndale, WA 98248' }
  ]
};
const BELLINGHAM_ATTRS = {
  OBJECTID: 991234, PERMIT_NO: 'BLD2026-0756', PermitType: 'EXISTING SINGLE FAMILY OR DUPLEX', PermitSubType: 'INTERIOR REMODEL',
  STATUS: 'ISSUED', APPLIED: 1788566400000, ISSUED: 1791158400000, FINALED: null, EXPIRED: null,
  SITE_ADDR: '1430 GRANT ST', SITE_APN: '380224510123', DESCRIPTION: 'KITCHEN REMODEL IN (E) SFR: GALBRAITH', JOBVALUE: 38000,
  OWNER_NAME: 'MELINDA GALBRAITH', APPLICANT_NAME: 'RAVEN RIDGE BUILDERS', CONTRACTOR_NAME: 'RAVEN RIDGE BUILDERS',
  TOTAL_FLOOR_AREA: 1284, NEW_FLOOR_AREA: 0, NUM_NEW_UNITS: 0, NEW_DWELL_UNITS: 0, PARENT_PROJECT_NO: null
};

describe('which permits are leads', () => {
  it('sorts county types by their exact names', () => {
    expect(categoryFor('whatcom', 'Building (Residential) - SFR - New Construction')).toBe('new_home');
    expect(categoryFor('whatcom', 'Building (Residential) - SFR - Alteration, Remodel, Repair')).toBe('remodel');
    expect(categoryFor('whatcom', 'Building (Residential) - Detached - New Construction')).toBe('adu');
    expect(categoryFor('whatcom', 'Building (Commercial) - Alteration/Tenant Improvement')).toBe('commercial_remodel');
    expect(categoryFor('whatcom', 'building (commercial)  -  new')).toBe('commercial_new');
  });

  it('leaves out the county types that aren’t leads', () => {
    for (const t of ['Building (Residential) - Re-Roof', 'Building (Residential) - Window Replacement', 'Mobile/Manufactured Home Structure - Manufactured Home', 'Mechanical (Residential) - Replacement', 'Fire Operational - Burn - Residential']) {
      expect(categoryFor('whatcom', t)).toBeNull();
    }
  });

  it('sorts Bellingham by type and subtype', () => {
    expect(categoryFor('bellingham', 'NEW CONSTRUCTION SINGLE FAMILY OR DUPLEX', 'NEW STRUCTURE')).toBe('new_home');
    expect(categoryFor('bellingham', 'NEW CONSTRUCTION TOWNHOME', 'NEW STRUCTURE')).toBe('new_home');
    expect(categoryFor('bellingham', 'EXISTING SINGLE FAMILY OR DUPLEX', 'ADU')).toBe('adu');
    expect(categoryFor('bellingham', 'EXISTING SINGLE FAMILY OR DUPLEX', 'INTERIOR REMODEL')).toBe('remodel');
    expect(categoryFor('bellingham', 'BUILDING MULTIFAMILY RESIDENTIAL', 'NEW CONSTRUCTION')).toBe('multifamily');
    expect(categoryFor('bellingham', 'BUILDING NONRESIDENTIAL', 'TENANT IMPROVEMENT')).toBe('commercial_remodel');
    expect(categoryFor('bellingham', 'EXISTING SINGLE FAMILY OR DUPLEX', 'REPAIR')).toBeNull();
    expect(categoryFor('bellingham', 'ELECTRICAL SINGLE FAMILY OR DUPLEX', '')).toBeNull();
  });

  it('reports building types nobody has sorted, and nothing else', () => {
    expect(isUnsortedBuildingType('whatcom', 'Building (Residential) - Pool House')).toBe(true);
    expect(isUnsortedBuildingType('whatcom', 'Building (Residential) - Re-Roof')).toBe(false);
    expect(isUnsortedBuildingType('whatcom', 'Building (Residential) - SFR - New Construction')).toBe(false);
    expect(isUnsortedBuildingType('whatcom', 'Plumbing (Residential) - New')).toBe(false);
    expect(isUnsortedBuildingType('bellingham', 'BUILDING NONRESIDENTIAL', 'CHANGE OF USE')).toBe(true);
    expect(isUnsortedBuildingType('bellingham', 'EXISTING SINGLE FAMILY OR DUPLEX', 'REPAIR')).toBe(false);
    expect(isUnsortedBuildingType('bellingham', 'SIGN AND AWNING', '')).toBe(false);
  });
});

describe('days', () => {
  it('takes the calendar day as the source wrote it', () => {
    expect(dayOf('2026-10-09T00:00:00')).toBe('2026-10-09');
    expect(dayOf('2026-10-11T23:06:32')).toBe('2026-10-11');
    expect(dayOf(1791158400000)).toBe('2026-10-05');
    expect(dayOf(null)).toBeNull();
    expect(dayOf('')).toBeNull();
    expect(dayOf('soon')).toBeNull();
  });

  it('shifts days across months and years', () => {
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('reads the Pacific clock, daylight saving included', () => {
    expect(pacificNow(new Date('2026-10-11T12:30:00Z'))).toEqual({ day: '2026-10-11', minutes: 5 * 60 + 30 });
    expect(pacificNow(new Date('2026-01-15T13:00:00Z'))).toEqual({ day: '2026-01-15', minutes: 5 * 60 });
    expect(pacificNow(new Date('2026-10-11T06:00:00Z')).day).toBe('2026-10-10');
  });

  it('runs once a day, from 5:00 AM Pacific', () => {
    const at459 = new Date('2026-10-11T11:59:00Z');
    const at500 = new Date('2026-10-11T12:00:00Z');
    expect(isDailyRunDue('2026-10-10', at459)).toBe(false);
    expect(isDailyRunDue('2026-10-10', at500)).toBe(true);
    expect(isDailyRunDue('2026-10-11', at500)).toBe(false);
    expect(isDailyRunDue(null, new Date('2026-10-11T22:00:00Z'))).toBe(true);
  });

  it('reads six months back the first time, then 30 days', () => {
    const at = new Date('2026-10-11T12:00:00Z');
    expect(runSince(false, at)).toBe('2026-04-11');
    expect(runSince(true, at)).toBe('2026-09-11');
  });

  it('lists the whole months between a start day and this month', () => {
    expect(fullMonthsBetween('2026-04-11', '2026-10')).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
    expect(fullMonthsBetween('2026-04-01', '2026-06')).toEqual(['2026-04', '2026-05']);
    expect(fullMonthsBetween('2025-11-15', '2026-02')).toEqual(['2025-12', '2026-01']);
    expect(fullMonthsBetween('2026-10-02', '2026-10')).toEqual([]);
  });

  it('knows each month’s first and last day', () => {
    expect(monthBounds('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthBounds('2026-08')).toEqual({ from: '2026-08-01', to: '2026-08-31' });
  });
});

describe('contacts', () => {
  it('compares phones by their last ten digits', () => {
    expect(phoneKey('(360) 739-7535')).toBe('3607397535');
    expect(phoneKey('+1 360.739.7535')).toBe('3607397535');
    expect(phoneKey('739-7535')).toBe('');
    expect(formatPhone('3607397535')).toBe('(360) 739-7535');
    expect(formatPhone('ext 12')).toBe('ext 12');
  });

  it('compares emails and company names loosely, but not too loosely', () => {
    expect(emailKey(' KVF1616@Gmail.com ')).toBe('kvf1616@gmail.com');
    expect(emailKey('n/a')).toBe('');
    expect(nameKey('Raven Ridge Builders, LLC')).toBe(nameKey('RAVEN RIDGE BUILDERS'));
    expect(nameKey('Smith & Sons Inc.')).toBe('SMITH AND SONS');
  });

  it('drops repeats and puts the contractor first', () => {
    const tidy = tidyContacts([
      { role: 'Owner', company: 'Ann Lee' },
      { role: 'Contractor - GC', company: 'Stremler Gravel', phone: '(360)354-8585' },
      { role: 'Contractor - GC', company: 'Stremler Gravel', phone: '360-354-8585' },
      { role: 'Applicant', company: '', name: '' }
    ]);
    expect(tidy.map((c) => [c.kind, c.company])).toEqual([['contractor', 'Stremler Gravel'], ['owner', 'Ann Lee']]);
  });

  it('knows a placeholder contractor', () => {
    expect(isPlaceholderName('TBD')).toBe(true);
    expect(isPlaceholderName('OWNER AS CONTRCT EXEMPT PER RCW18.27.090')).toBe(true);
    expect(isPlaceholderName('Fox Lake Builders')).toBe(false);
  });

  it('spots Bellingham’s final-only permits', () => {
    expect(isFinalOnly('FINAL-ONLY PERMIT FOR BLD2023-0792')).toBe(true);
    expect(isFinalOnly('FINAL ONLY PERMIT TO COMPLETE CMB99-00165')).toBe(true);
    expect(isFinalOnly('L3 NEW TOWNHOME W/ (A) GARAGE')).toBe(false);
  });
});

describe('source records', () => {
  it('copies a county permit and its details exactly', () => {
    const p = whatcomPermit(WHATCOM_ROW, WHATCOM_DETAIL);
    expect(p).toMatchObject({
      source: 'whatcom', permitNumber: 'SFR2026-00212', category: 'new_home', status: 'Issued',
      issuedOn: '2026-10-06', appliedOn: '2026-05-18', address: '2996 BROOK LN', city: 'Sedro Woolley', zip: '98284',
      parcel: '3704292102230000', valuation: 307360, sqft: 2808,
      sourceUrl: whatcomPermitUrl('b040c9fa-1ee6-4853-b2b5-d0f79638936c')
    });
    expect(p.description).toMatch(/^New, w\/ lu, SFR/);
    expect(p.contacts[0]).toMatchObject({ kind: 'contractor', role: 'Contractor - GC', company: 'KVF Construction', name: 'Vladimir Kolesnikov', phone: '3607397535', email: 'kvf1616@gmail.com' });
    expect(p.contacts.map((c) => c.kind)).toEqual(['contractor', 'owner', 'applicant']);
    expect(p.contacts[2].address).toBe('4340 PACIFIC HWY Unit: 202 Bellingham, WA 98226');
  });

  it('leaves detail fields unset when the details didn’t load, so a save keeps the old ones', () => {
    const p = whatcomPermit(WHATCOM_ROW, null);
    expect(p.valuation).toBeUndefined();
    expect(p.contacts).toBeUndefined();
    expect(p.issuedOn).toBe('2026-10-06');
  });

  it('copies a Bellingham permit exactly', () => {
    const p = bellinghamPermit(BELLINGHAM_ATTRS);
    expect(p).toMatchObject({
      source: 'bellingham', permitNumber: 'BLD2026-0756', externalId: '991234', category: 'remodel',
      type: 'EXISTING SINGLE FAMILY OR DUPLEX', subtype: 'INTERIOR REMODEL', status: 'ISSUED',
      issuedOn: '2026-10-05', address: '1430 GRANT ST', city: 'Bellingham', valuation: 38000, sqft: 1284, units: null, finalOnly: false
    });
    expect(p.contacts.map((c) => [c.kind, c.company])).toEqual([
      ['contractor', 'RAVEN RIDGE BUILDERS'], ['owner', 'MELINDA GALBRAITH'], ['applicant', 'RAVEN RIDGE BUILDERS']
    ]);
  });

  it('prefers the new floor area, and keeps a zero value empty rather than $0', () => {
    const p = bellinghamPermit({ ...BELLINGHAM_ATTRS, NEW_FLOOR_AREA: 3188, JOBVALUE: 0, NUM_NEW_UNITS: 55 });
    expect(p.sqft).toBe(3188);
    expect(p.valuation).toBeNull();
    expect(p.units).toBe(55);
  });
});

describe('the county’s monthly report', () => {
  it('reads the month from the archive titles the county uses', () => {
    expect(reportMonthOf('Permit Issued August 2026')).toBe('2026-08');
    expect(reportMonthOf('Permits Issued Listing March 2026')).toBe('2026-03');
    expect(reportMonthOf('Permits Issued Report Sept 2025')).toBe('2025-09');
    expect(reportMonthOf('Building Permits Issued Report July 2025')).toBe('2025-07');
    expect(reportMonthOf('Permits Issued Feb 2026')).toBe('2026-02');
  });

  it('skips contractor listings and multi-month reports', () => {
    expect(reportMonthOf('Contractor Listing on Issued Permits August 2026')).toBeNull();
    expect(reportMonthOf('Building Permit Issued Report April-June 2025')).toBeNull();
    expect(reportMonthOf('2025 Annual Permits Received Report')).toBeNull();
  });

  it('takes permit numbers from the first column only', () => {
    const items = [
      { str: 'COM2026-00084', x: 18 }, { str: 'SFR2026-00220', x: 18 }, { str: 'SFR2026-00220', x: 18 },
      { str: 'SFR2026-00194', x: 157 }, // mentioned in a description
      { str: 'Permit #', x: 18 }, { str: '08/06/2026', x: 198 }
    ];
    expect(reportPermitNumbers(items)).toEqual(['COM2026-00084', 'SFR2026-00220']);
  });

  const search = (n, day, type = 'Building (Residential) - SFR - New Construction') => ({ CaseNumber: n, CaseType: type, IssueDate: `${day}T00:00:00` });

  it('compares the month so far with a second search, both ways', () => {
    expect(compareMonthToDate({ found: ['A', 'B', 'C'], app: ['A', 'B', 'D'] }))
      .toEqual({ inSearch: 3, matched: 2, missingFromApp: ['C'], notFoundAgain: ['D'], ok: false });
    expect(compareMonthToDate({ found: ['A'], app: ['A'] }).ok).toBe(true);
  });

  it('reads the county’s permit-number codes', () => {
    expect(permitPrefix('SFR2026-00212')).toBe('SFR');
    expect(permitPrefix('FIRE-CON2026-00064')).toBe('FIRE-CON');
  });

  it('finds differences both ways, ignoring report permits that aren’t lead types', () => {
    const r = reconcileReport({
      month: '2026-08',
      reportNumbers: ['SFR2026-00001', 'SFR2026-00002', 'EFR2026-00001', 'COM2026-00001'],
      searchRows: [
        search('SFR2026-00001', '2026-08-04'), search('SFR2026-00002', '2026-08-05'), search('COM2026-00001', '2026-08-06', 'Building (Commercial) - New'),
        search('EFR2026-00001', '2026-08-07', 'Building (Commercial) - Eligible Facility Request'), search('SFR2026-00009', '2026-08-09')
      ],
      appInMonth: ['SFR2026-00001', 'COM2026-00001', 'SFR2026-00009'],
      appHas: ['SFR2026-00001', 'COM2026-00001'],
      leadPrefixes: ['SFR', 'DET', 'COM']
    });
    expect(r).toMatchObject({ inReport: 4, leadsInReport: 3, matched: 2, missingFromApp: ['SFR2026-00002'], notInReport: ['SFR2026-00009'], ok: false });
  });

  it('accepts a permit the county re-issued later, which the app holds under its new date', () => {
    // SFR2025-00382: in July's report, since re-issued on Aug 12 (and in August's report too).
    const r = reconcileReport({
      month: '2026-07',
      reportNumbers: ['SFR2025-00382'],
      searchRows: [search('SFR2025-00382', '2026-08-12', 'Building (Residential) - SFR - Addition')],
      appInMonth: [], appHas: ['SFR2025-00382'], leadPrefixes: ['SFR']
    });
    expect(r).toMatchObject({ ok: true, matched: 1, datesMoved: ['SFR2025-00382'], missingFromApp: [] });
  });

  it('lists permits the public search hides, and counts them missing only when they’re lead codes', () => {
    // FIRE-CON2026-00067: a gate permit in August's report that the county's public search doesn't show.
    const r = reconcileReport({
      month: '2026-08',
      reportNumbers: ['FIRE-CON2026-00067', 'SFR2026-00777'],
      searchRows: [], appInMonth: [], appHas: [], leadPrefixes: ['SFR', 'DET', 'COM']
    });
    expect(r).toMatchObject({ ok: false, notPublic: ['FIRE-CON2026-00067'], notInCountySearch: ['SFR2026-00777'], missingFromApp: ['SFR2026-00777'] });
  });
});
