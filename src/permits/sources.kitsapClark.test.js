// Kitsap County and Clark County: how their layers' records become leads
// (real records trimmed from the layers, 2026-10-22), and the readers' queries,
// count checks and (Clark) the address lookup.
import { describe, it, expect } from 'vitest';
import kitsap, { kitsapPermit } from './rules/kitsapCounty.js';
import clark, { clarkPermit, clarkAddress } from './rules/clarkCounty.js';
import { createKitsapCountySource, kitsapWhere } from './sources/kitsapCounty.js';
import { createClarkCountySource, clarkWhere } from './sources/clarkCounty.js';
import { RULES, SOURCES, categoryFor, isUnsortedBuildingType } from './permitRules.js';

const noSleep = async () => {};
const json = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
const feature = (attributes) => ({ attributes });

describe('Kitsap County rules', () => {
  const SFR = {
    ObjectId: 22000, Permit_Number: '26-04001', Parcel_No: '5001-000-042-0008', Permit_Status: 'ISSUED', Permit_Type: 'R-SFR',
    Permit_Type_Description: 'Single Family Residence', Permit_SubCategory: 'Res - New Construction', Project_Name: 'FAVRO - New SFR',
    Site_Address: '20945 CINDY CT NE', Date_Submitted: Date.UTC(2026, 5, 1), DateIssued: Date.UTC(2026, 9, 8), Value: 410000,
    Squarefootage: 2200, Units: 1, SmartGovlink: 'https://co-kitsap-wa.smartgovcommunity.com/Parcels/ParcelDetail/Index/abc', Department: 'RESIDENTIAL'
  };
  const cat = (sub, type) => categoryFor('kitsap_county', sub, type);

  it('is a county source in Kitsap, with no contacts', () => {
    expect(RULES.kitsap_county).toBe(kitsap);
    expect(SOURCES.kitsap_county).toMatchObject({ county: 'kitsap', kind: 'county' });
  });

  it('copies a new home as the county sent it', () => {
    expect(kitsapPermit(SFR)).toMatchObject({
      source: 'kitsap_county', permitNumber: '26-04001', category: 'new_home', type: 'Res - New Construction', subtype: 'R-SFR',
      status: 'ISSUED', issuedOn: '2026-10-08', address: '20945 CINDY CT NE', parcel: '5001-000-042-0008', valuation: 410000, sqft: 2200,
      units: 1, projectName: 'FAVRO - New SFR', contacts: [], city: ''
    });
  });

  it('sorts the lead types', () => {
    expect(cat('Res - New Construction', 'R-SFR/USING BASIC')).toBe('new_home');
    expect(cat('Res - New Construction', 'R-SFR/TOWNHOME')).toBe('multifamily');
    expect(cat('Res - New Construction', 'R-SFR/ADU-D')).toBe('adu');
    expect(cat('Res - Alter/Reno/Add', 'R-SFR/ADD')).toBe('addition');
    expect(cat('Res - Alter/Reno/Add', 'R-SFR/REMODEL-MINOR')).toBe('remodel');
    expect(cat('Comm - New Construction', 'C-CHURCH')).toBe('commercial_new');
    expect(cat('Comm - Alter/Reno/Add', 'C-TENANT IMPROVEMENT')).toBe('commercial_remodel');
  });

  it('skips outbuildings, manufactured homes, re-roofs, demolitions and trades without reporting them', () => {
    for (const [s, t] of [
      ['Res - Other Construction', 'R-GARAGE/ACCESSORY BUILDING'], ['Res - Other Construction', 'R-DECK'], ['Res - Other Construction', 'R-MECH/PLUM'],
      ['Res - New Construction', 'MH-LOT'], ['Res - Alter/Reno/Add', 'R-REROOF AND/OR RESIDING'], ['Res - Demo', 'DEMO RESIDENTIAL'],
      ['Comm - Alter/Reno/Add', 'C-TENANT CHANGE'], ['Comm - Other Construction', 'SIGN']
    ]) {
      expect(cat(s, t), `${s} ${t}`).toBeNull();
      expect(isUnsortedBuildingType('kitsap_county', s, t)).toBe(false);
    }
  });

  it('reports a new/alter type nobody has sorted', () => {
    expect(isUnsortedBuildingType('kitsap_county', 'Res - Alter/Reno/Add', 'R-SFR/REPLACE')).toBe(true);
    expect(isUnsortedBuildingType('kitsap_county', 'Res - Alter/Reno/Add', 'R-SFR/REMODEL-MAJOR')).toBe(false);
  });

  it('reads only residential and commercial permits issued since the start, and refuses a short answer', async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      const p = new URL(url).searchParams;
      calls.push(Object.fromEntries(p));
      if (p.get('returnCountOnly') === 'true') return json({ count: 3 });
      return json({ features: [feature({ ObjectId: 1 }), feature({ ObjectId: 2 })] });
    };
    await expect(createKitsapCountySource({ fetchImpl, sleep: noSleep }).issuedSince('2026-10-01')).rejects.toThrow(/said 3 permits but sent 2/);
    expect(calls[0].where).toBe("DateIssued >= DATE '2026-10-01' AND Department IN ('RESIDENTIAL', 'COMMERCIAL')");
    expect(calls[1].orderByFields).toBe('ObjectId');
    expect(() => kitsapWhere("2026-10-01' OR 1=1 --")).toThrow();
  });
});

describe('Clark County rules', () => {
  const NHC = { OBJECTID: 668991, caseno: 'NHC-2024-01505', case_type: 'NHC', CaseType: 'New construction home with adult family care home', WorkType: null, sn: 107029010, name: 'Slavik Storozhko', status: 'ISSUED', issued: Date.parse('2026-09-16T10:00:00-07:00') };
  const POINTS = [
    { SN: 107029010, HsNbr: 6205, HsSub: '', StDir: 'NE', StName: '105TH', Stype: 'AVE', Building: '', Unit: 'B', Zip: 98662, USPS_CITY: 'VANCOUVER', Jurisdiction: 'CLARK COUNTY' },
    { SN: 107029010, HsNbr: 6205, HsSub: '', StDir: 'NE', StName: '105TH', Stype: 'AVE', Building: '', Unit: '', Zip: 98662, USPS_CITY: 'VANCOUVER', Jurisdiction: 'CLARK COUNTY' }
  ];
  const cat = (type, work = '') => categoryFor('clark_county', type, work);

  it('is a county source in Clark, listed in the rules', () => {
    expect(RULES.clark_county).toBe(clark);
    expect(SOURCES.clark_county).toMatchObject({ county: 'clark', kind: 'county' });
  });

  it('picks the parcel’s main address, falling back to the first', () => {
    expect(clarkAddress(POINTS)).toEqual({ address: '6205 NE 105TH AVE', city: 'Vancouver', zip: '98662', jurisdiction: 'Clark County' });
    expect(clarkAddress([POINTS[0]]).address).toBe('6205 NE 105TH AVE #B');
    expect(clarkAddress([])).toBeNull();
  });

  it('copies a new home with its address and the applicant', () => {
    const p = clarkPermit({ ...NHC, _address: clarkAddress(POINTS) });
    expect(p).toMatchObject({
      source: 'clark_county', permitNumber: 'NHC-2024-01505', category: 'new_home', type: 'NHC', status: 'ISSUED', issuedOn: '2026-09-16',
      address: '6205 NE 105TH AVE', city: 'Vancouver', zip: '98662', parcel: '107029010', description: 'New construction home with adult family care home'
    });
    expect(p.contacts).toMatchObject([{ role: 'Applicant', company: 'Slavik Storozhko' }]);
  });

  it('sorts the lead types and skips re-roofs, solar, signs and inspections without reporting them', () => {
    expect(cat('RES', 'NEWBLDG')).toBe('new_home');
    expect(cat('RES', 'ADDITION')).toBe('addition');
    expect(cat('RES', 'ADD/REM')).toBe('remodel');
    expect(cat('NHC')).toBe('new_home');
    expect(cat('CMI', 'NEWBLDG')).toBe('commercial_new');
    expect(cat('CMI', 'TI')).toBe('commercial_remodel');
    for (const [t, w] of [['RES', 'REROOF'], ['RES', 'SOLAR'], ['RES', 'INSPONLY'], ['CMI', 'SIGN'], ['CMI', 'RACK']]) {
      expect(cat(t, w)).toBeNull();
      expect(isUnsortedBuildingType('clark_county', t, w)).toBe(false);
    }
    expect(isUnsortedBuildingType('clark_county', 'RES', 'NEWTHING')).toBe(true);
  });

  it('asks only for building case types in the window, never a typo date years ahead', () => {
    expect(clarkWhere('2026-10-01', '2026-10-22')).toBe("issued >= DATE '2026-10-01' AND issued < DATE '2026-10-24' AND case_type IN ('RES', 'NHC', 'SFR', 'CMI')");
    expect(() => clarkWhere("2026-10-01' OR 1=1 --")).toThrow();
  });

  it('adds addresses to the leads only, in batches, and fails if the address lookup fails', async () => {
    const permits = [
      { OBJECTID: 1, caseno: 'NHC-1', case_type: 'NHC', sn: 107029010, issued: Date.UTC(2026, 9, 1, 20) },
      { OBJECTID: 2, caseno: 'RES-2', case_type: 'RES', WorkType: 'REROOF', sn: 555, issued: Date.UTC(2026, 9, 1, 20) }
    ];
    const addressCalls = [];
    let addressFails = false;
    const fetchImpl = async (url) => {
      const p = new URL(url).searchParams;
      if (url.includes('Addressing')) {
        addressCalls.push(p.get('where'));
        if (addressFails) return { ok: false, status: 500, text: async () => 'down' };
        return json({ features: POINTS.map(feature) });
      }
      if (p.get('returnCountOnly') === 'true') return json({ count: permits.length });
      return json({ features: permits.map(feature) });
    };
    const reader = createClarkCountySource({ fetchImpl, sleep: noSleep, today: '2026-10-22' });
    const { rows } = await reader.issuedSince('2026-10-01');
    expect(addressCalls).toEqual(['SN IN (107029010)']);
    expect(clarkPermit(rows[0]).address).toBe('6205 NE 105TH AVE');
    expect(rows[1]._address).toBeUndefined();
    addressFails = true;
    await expect(reader.issuedSince('2026-10-01')).rejects.toThrow();
  });
});
