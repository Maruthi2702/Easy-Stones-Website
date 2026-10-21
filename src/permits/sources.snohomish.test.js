// Snohomish County: the monthly reports' exact types, how a row copies into a
// permit, the archive page's file list, and the reader's stop rules — against
// trimmed real rows from the county's September 2026 reports (read 2026-10-20)
// and fake servers.
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { Buffer } from 'node:buffer';
import rule, { parseSnohomishArchive, snohomishFilesSince, rowBelongsToFile, snohomishPermit } from './rules/snohomishCounty.js';
import { RULES, categoryFor, isUnsortedBuildingType, SOURCES, sourcesInCounties } from './permitRules.js';
import { createSnohomishCountySource, reportRows } from './sources/snohomishCounty.js';
import { marysvillePermit } from './rules/marysville.js';
import { createEnergovSource } from './sources/energov.js';
import { monroePermit, parseMonroeReports, monroeReportRows } from './rules/monroe.js';
import { createMonroeSource } from './sources/monroe.js';

const row = (over) => ({
  Project_File_Number: '25-102950 RBP', Permit_Description: 'Residential Building Permit', Sub_Type: 'Single Family Residential', Work_Type: 'New',
  Application_Date: '03/06/2025', Issue_Date: '09/01/2026', Status: 'Issued', Folder_Name: 'Corey RBP', Description: 'New 1 bdrm 2nd story SFR',
  Valuation: 245973.96, Dwelling_Units: 1, Total_Bldg_Sq_Ft: null, Site_Address: '11109 86TH ST SE ', Site_City: 'SNOHOMISH', Site_Postal: 98290,
  Tax_Account_Number: '28061800101300', Applicant_Name: 'Stacy Smith', Applicant_Organization: 'Smith Land Developement Services',
  Applicant_Address: '6428 221ST AVE NE GRANITE FALLS WA  98252', PDS_Contact_Name: 'Staff', PDS_Contact_Phone: '(425) 555-0100', PDS_Contact_Email: 'staff@co.snohomish.wa.us', ...over
});

describe('Snohomish County types', () => {
  const cat = (desc, sub, work) => categoryFor('snohomish_county', desc, `${sub} | ${work}`);
  it('files the county’s exact residential types', () => {
    expect(cat('Residential Building Permit', 'Single Family Residential', 'New')).toBe('new_home');
    expect(cat('Residential Building Permit', 'SFR-Basic (Approved Contractors Only)', 'New')).toBe('new_home');
    expect(cat('Residential Building Permit', 'Accessory Dwelling Detached', 'New')).toBe('adu');
    expect(cat('Residential Building Permit', 'Single Family Residential', 'Addition')).toBe('addition');
    expect(cat('Residential Building Permit', 'Single Family Residential', 'Alteration')).toBe('remodel');
    expect(cat('Residential Building Permit', 'Duplex', 'New')).toBe('multifamily');
    expect(cat('Townhouse Permit', 'Townhouse', 'New')).toBe('multifamily');
  });
  it('files the commercial types', () => {
    expect(cat('Commercial Building Permit', 'Occupied Building', 'New')).toBe('commercial_new');
    expect(cat('Commercial Building Permit', 'Tenant Improvement', 'Alteration')).toBe('commercial_remodel');
  });
  it('does not make a lead of repairs, outbuildings, signs, demolitions or finished work', () => {
    const ignored = [
      ['Residential Building Permit', 'Single Family Residential', 'Repair'],
      ['Residential Building Permit', 'Garage', 'New'],
      ['Residential Building Permit', 'Deck', 'Replacement'],
      ['Residential Building Permit', 'Accessory Dwelling Detached', 'Complete Work'],
      ['Residential Building Permit', 'Single Family Residential', 'Foundation Only'],
      ['Demolition Permit', 'Single Family Residential', 'Demo Only'],
      ['Sign Permit', 'Commercial', 'New'],
      ['Commercial Building Permit', 'PWSF Tower', 'New']
    ];
    for (const [d, s, w] of ignored) {
      expect(cat(d, s, w), `${d} ${s} ${w}`).toBeNull();
      expect(isUnsortedBuildingType('snohomish_county', d, `${s} | ${w}`), `${d} ${s} ${w}`).toBe(false);
    }
  });
  it('reports a building type nobody has sorted', () => {
    expect(isUnsortedBuildingType('snohomish_county', 'Residential Building Permit', 'Treehouse | New')).toBe(true);
    expect(isUnsortedBuildingType('snohomish_county', 'Commercial Building Permit', 'Hangar | New')).toBe(true);
  });
  it('is the Snohomish county office', () => {
    expect(SOURCES.snohomish_county).toMatchObject({ county: 'snohomish', countyLabel: 'Snohomish County', kind: 'county' });
    expect(RULES.snohomish_county.typeOf(row())).toEqual(['Residential Building Permit', 'Single Family Residential | New']);
  });
});

describe('snohomishPermit', () => {
  it('copies the county’s figures and applicant, nothing guessed', () => {
    expect(snohomishPermit(row())).toMatchObject({
      source: 'snohomish_county', permitNumber: '25-102950 RBP', category: 'new_home', status: 'Issued',
      appliedOn: '2025-03-06', issuedOn: '2026-09-01', address: '11109 86TH ST SE', city: 'Snohomish', zip: '98290',
      parcel: '28061800101300', projectName: 'Corey RBP', valuation: 245973.96, sqft: null, units: 1, finalOnly: false
    });
  });
  it('lists the applicant as the contact, with no phone — and never the county’s own staff', () => {
    const { contacts } = snohomishPermit(row());
    expect(contacts).toEqual([expect.objectContaining({ kind: 'applicant', company: 'Smith Land Developement Services', name: 'Stacy Smith', phone: '', email: '' })]);
    expect(JSON.stringify(contacts)).not.toMatch(/co\.snohomish|555-0100|Staff/);
  });
  it('has no contact when the report names nobody', () => {
    expect(snohomishPermit(row({ Applicant_Name: '', Applicant_Organization: '', Applicant_Address: '' })).contacts).toEqual([]);
  });
  it('reads the zip from a number or text, and leaves units to the second column when the first is empty', () => {
    expect(snohomishPermit(row({ Site_Postal: '98037' })).zip).toBe('98037');
    expect(snohomishPermit(row({ Dwelling_Units: null, Number_of_Dwelling_Units: 8 })).units).toBe(8);
  });
});

describe('the archive page', () => {
  const html = (items) => items.map(([id, t]) => `<table><tr><td><span class="archive"><a href="Archive.aspx?ADID=${id}" target="_blank"><span>${t}  </span></a></span></td></tr></table>`).join('');
  const page = html([[7544, 'September 2026 Issued Residential Permits'], [7420, 'February 2026 Residential Issued Permits'], [7398, '2025 Issued Residential Permits'], [1, 'Read me']]);
  it('lists monthly and yearly files, newest first, and skips what names no period', () => {
    expect(parseSnohomishArchive(page)).toEqual([
      { id: '7544', title: 'September 2026 Issued Residential Permits', month: '2026-09', year: null },
      { id: '7420', title: 'February 2026 Residential Issued Permits', month: '2026-02', year: null },
      { id: '7398', title: '2025 Issued Residential Permits', month: null, year: '2025' }
    ]);
  });
  it('picks the files that can hold permits since a day', () => {
    const files = parseSnohomishArchive(page);
    expect(snohomishFilesSince(files, '2026-02-15').map((f) => f.id)).toEqual(['7544', '7420']);
    expect(snohomishFilesSince(files, '2025-11-01').map((f) => f.id)).toEqual(['7544', '7420', '7398']);
    expect(snohomishFilesSince(files, '2026-10-01')).toEqual([]);
  });
  it('knows which file a day belongs to', () => {
    const [month, , year] = parseSnohomishArchive(page);
    expect(rowBelongsToFile(month, '2026-09-30')).toBe(true);
    expect(rowBelongsToFile(month, '2026-10-01')).toBe(false);
    expect(rowBelongsToFile(year, '2025-12-31')).toBe(true);
    expect(rowBelongsToFile(month, null)).toBe(false);
  });
});

describe('the reader', () => {
  const COLS = Object.keys(row());
  const sheet = (rows, cols = COLS) => {
    const ws = XLSX.utils.aoa_to_sheet([cols.map((c) => (c === 'Valuation' ? ' Valuation ' : c)), ...rows.map((r) => cols.map((c) => r[c] ?? null))]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  };
  const listing = (items) => items.map(([id, t]) => `<a href="Archive.aspx?ADID=${id}"><span>${t}</span></a>`).join('');
  const SHEET = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const server = ({ res = [], com = [], files = {} }) => async (url) => {
    const u = new URL(url);
    const amid = u.searchParams.get('AMID');
    if (amid) {
      const list = amid === '132' ? res : com;
      return new Response(listing(list), { status: 200, headers: { 'content-type': 'text/html' } });
    }
    const f = files[u.searchParams.get('ADID')];
    if (!f) return new Response('no', { status: 404 });
    return new Response(f.body, { status: 200, headers: { 'content-type': f.type || SHEET } });
  };

  it('reads each report’s files since the day, tags the report and keeps only permits issued since', async () => {
    const reader = createSnohomishCountySource({ fetchImpl: server({
      res: [[2, 'September 2026 Issued Residential Permits'], [1, 'August 2026 Issued Residential Permits']],
      com: [[3, 'September 2026 Issued Commercial Permits']],
      files: {
        2: { body: sheet([row(), row({ Project_File_Number: '26-1 RBP', Issue_Date: '09/20/2026' })]) },
        1: { body: sheet([row({ Project_File_Number: '26-0 RBP', Issue_Date: '08/05/2026' })]) },
        3: { body: sheet([row({ Project_File_Number: '26-9 CBP', Permit_Description: 'Commercial Building Permit', Issue_Date: '09/02/2026' })]) }
      }
    }) });
    const { rows, pages, total } = await reader.issuedSince('2026-09-10');
    expect(rows.map((r) => [r.Project_File_Number, r._report])).toEqual([['26-1 RBP', 'residential']]);
    // August is before the window; the commercial September file holds only a permit issued before the 10th.
    expect(pages).toBe(2);
    expect(total).toBe(1);
  });

  it('trims the county’s " Valuation " header so the figure reads', async () => {
    const reader = createSnohomishCountySource({ fetchImpl: server({ res: [[2, 'September 2026 Issued Residential Permits']], com: [[3, 'September 2026 Issued Commercial Permits']], files: { 2: { body: sheet([row()]) }, 3: { body: sheet([]) } } }) });
    const { rows } = await reader.issuedSince('2026-09-01');
    expect(rows[0].Valuation).toBe(245973.96);
  });

  it('stops when a file holds a permit issued in another month', async () => {
    const reader = createSnohomishCountySource({ fetchImpl: server({
      res: [[2, 'September 2026 Issued Residential Permits']], com: [[3, 'September 2026 Issued Commercial Permits']],
      files: { 2: { body: sheet([row({ Issue_Date: '10/01/2026' })]) }, 3: { body: sheet([]) } }
    }) });
    await expect(reader.issuedSince('2026-09-01')).rejects.toThrow(/stopped so nothing is missed/);
  });

  it('stops when the layout has changed, or the download is not a spreadsheet', async () => {
    const noCol = COLS.filter((c) => c !== 'Issue_Date');
    await expect(createSnohomishCountySource({ fetchImpl: server({ res: [[2, 'September 2026 Issued Residential Permits']], com: [[3, 'September 2026 Issued Commercial Permits']], files: { 2: { body: sheet([row()], noCol) } } }) }).issuedSince('2026-09-01'))
      .rejects.toThrow(/has changed — no Issue_Date column/);
    await expect(createSnohomishCountySource({ fetchImpl: server({ res: [[2, 'September 2026 Issued Residential Permits']], com: [[3, 'September 2026 Issued Commercial Permits']], files: { 2: { body: '<html>', type: 'text/html' } } }) }).issuedSince('2026-09-01'))
      .rejects.toThrow(/not a spreadsheet/);
  });

  it('stops when an archive page lists nothing, and reads nothing from a window with no files yet', async () => {
    await expect(createSnohomishCountySource({ fetchImpl: server({ res: [], com: [] }) }).issuedSince('2026-09-01')).rejects.toThrow(/may have moved/);
    const quiet = createSnohomishCountySource({ fetchImpl: server({ res: [[2, 'September 2026 Issued Residential Permits']], com: [[3, 'September 2026 Issued Commercial Permits']] }) });
    expect(await quiet.issuedSince('2026-10-01')).toEqual({ rows: [], pages: 0, total: 0 });
  });

  it('reportRows names the missing column', () => {
    expect(() => reportRows([['Project_File_Number']])).toThrow(/Permit_Description/);
    expect(reportRows([])).toEqual([]);
  });

  it('turns a read row into the same permit the rules describe', () => {
    expect(rule.toPermit(row()).permitNumber).toBe('25-102950 RBP');
  });
});

describe('Snohomish County cities', () => {
  const cat = (t) => categoryFor('edmonds', t);
  it('Edmonds: files the city’s exact building types', () => {
    expect(cat('SINGLE FAMILY-NEW CONSTRUCTION-NEW')).toBe('new_home');
    expect(cat('SINGLE FAMILY-ACCESSORY DWELLING UNIT DETACHED-NEW')).toBe('adu');
    expect(cat('SINGLE FAMILY-STRUCTURE ADDITION-ADDITION')).toBe('addition');
    expect(cat('SINGLE FAMILY-REMODEL-ALTERATION')).toBe('remodel');
    expect(cat('CONDOMINIUM-NEW CONSTRUCTION-NEW')).toBe('multifamily');
    expect(cat('COMMERCIAL-NEW CONSTRUCTION-NEW')).toBe('commercial_new');
    expect(cat('COMMERCIAL-TENANT IMPROVEMENT-ALTERATION')).toBe('commercial_remodel');
  });
  it('Edmonds: skips trades, roofs, signs, outbuildings and the rest, and reports a new building type', () => {
    for (const t of ['SINGLE FAMILY-MECHANICAL-NEW', 'SINGLE FAMILY-PLUMBING-REPAIR OR REPLACEMENT', 'SINGLE FAMILY-RE-ROOF-REPAIR OR REPLACEMENT',
      'COMMERCIAL-SIGN-NEW', 'SINGLE FAMILY-DECK/PORCH/PATIO COVER-NEW', 'SINGLE FAMILY-DEMO PRIMARY STRUCTURE-OTHER', 'SINGLE FAMILY-FENCE-NEW',
      'SINGLE FAMILY-ADULT FAMILY HOME-ALTERATION', 'RIGHT OF WAY - EUC MINOR', 'WATER METER - DOMESTIC ONLY', 'COMMERCIAL - FIRE ALARM - NEW']) {
      expect(cat(t), t).toBeNull();
      expect(isUnsortedBuildingType('edmonds', t), t).toBe(false);
    }
    expect(isUnsortedBuildingType('edmonds', 'SINGLE FAMILY-GREENHOUSE-NEW')).toBe(true);
    expect(isUnsortedBuildingType('edmonds', 'COMMERCIAL-HANGAR-NEW')).toBe(true);
  });
  it('sits under the Snohomish filter, after the county’s own office, and stamps times', () => {
    expect(SOURCES.edmonds).toMatchObject({ county: 'snohomish', countyLabel: 'Snohomish County', kind: 'city' });
    expect(RULES.edmonds.stampsTime).toBe(true);
    expect(sourcesInCounties(['snohomish'])).toEqual(['snohomish_county', 'edmonds', 'marysville', 'monroe', 'snohomish_city']);
  });
});

describe('Marysville', () => {
  const cat = (t, s = '') => categoryFor('marysville', t, s);
  const lead = {
    PERMIT_NO: 'B26-0589', APPLIED: '09/22/2026', ISSUED: '10/14/2026', FINALED: '10/16/2026', 'Permit Type': 'RESIDENTIAL NEW', 'Permit Sub Type': 'SINGLE FAMILY',
    STATUS: 'ISSUED', SITE_APN: '30050400201900', SITE_ADDR: '4218 136TH ST NE', DESCRIPTION: 'LOT 12 NEW SFR', NOTES: 'Plan 4B', JOBVALUE: '412000',
    APPLICANT_NAME: 'Acme Homes LLC', CONTRACTOR_NAME: 'ACME HOMES, LLC', RECORDID: 'ECON:260922022102811'
  };
  it('files the city’s exact building types', () => {
    expect(cat('RESIDENTIAL NEW', 'SINGLE FAMILY')).toBe('new_home');
    expect(cat('RESIDENTIAL NEW', 'ACCESSORY DWELLING UNIT')).toBe('adu');
    expect(cat('RESIDENTIAL NEW', 'DUPLEX')).toBe('multifamily');
    expect(cat('RESIDENTIAL ADDITION', 'SINGLE FAMILY')).toBe('addition');
    expect(cat('RESIDENTIAL REMODEL', 'SINGLE FAMILY')).toBe('remodel');
    expect(cat('MULTI FAMILY APARTMENT NEW')).toBe('multifamily');
    expect(cat('COMMERCIAL NEW')).toBe('commercial_new');
    expect(cat('COMMERCIAL TENANT IMPROVEMENT')).toBe('commercial_remodel');
    expect(cat('RESIDENTIAL BASIC')).toBe('building_other');
  });
  it('skips what is not a lead and reports a new building type', () => {
    for (const [t, s] of [['BLS', 'HOME OCC - OFFICE'], ['ANIMAL LICENSE', 'NEW LICENSE'], ['RESIDENTIAL MECHANICAL', 'RESIDENTIAL'], ['COMMERCIAL REROOF', ''],
      ['RESIDENTIAL DECKS', ''], ['RESIDENTIAL REPAIR', 'SINGLE FAMILY'], ['RESIDENTIAL REMODEL', 'ADULT FAMILY HOME'], ['DEMO', ''], ['COMMERCIAL ELECTRICAL', '']]) {
      expect(cat(t, s), `${t} ${s}`).toBeNull();
      expect(isUnsortedBuildingType('marysville', t, s), `${t} ${s}`).toBe(false);
    }
    expect(isUnsortedBuildingType('marysville', 'RESIDENTIAL NEW', 'CASTLE')).toBe(true);
    expect(isUnsortedBuildingType('marysville', 'COMMERCIAL ADDITION', '')).toBe(true);
  });
  it('copies the export’s figures, with the contractor once when they also applied', () => {
    expect(marysvillePermit(lead)).toMatchObject({
      source: 'marysville', permitNumber: 'B26-0589', category: 'new_home', status: 'ISSUED', appliedOn: '2026-09-22', issuedOn: '2026-10-14',
      finaledOn: '2026-10-16', address: '4218 136TH ST NE', city: 'Marysville', parcel: '30050400201900', valuation: 412000, description: 'LOT 12 NEW SFR — Plan 4B'
    });
    expect(marysvillePermit(lead).contacts).toEqual([expect.objectContaining({ kind: 'contractor', company: 'ACME HOMES, LLC' })]);
    expect(marysvillePermit({ ...lead, APPLICANT_NAME: 'Jo Owner' }).contacts.map((c) => c.kind)).toEqual(['contractor', 'applicant']);
    expect(marysvillePermit({ ...lead, JOBVALUE: '0' }).valuation).toBeNull();
  });
  it('is under the Snohomish filter and reads through the shared eTRAKiT reader with its own columns', () => {
    expect(SOURCES.marysville).toMatchObject({ county: 'snohomish', kind: 'city' });
    expect(rule).toBeTruthy();
  });
});

describe('City of Snohomish', () => {
  const cat = (t) => categoryFor('snohomish_city', t);
  it('files the city’s exact building types', () => {
    expect(cat('Single-Family New Construction')).toBe('new_home');
    expect(cat('Accessory Dwelling Unit')).toBe('adu');
    expect(cat('Residential Addition/Alteration')).toBe('remodel');
    expect(cat('Commercial New Construction')).toBe('commercial_new');
    expect(cat('Commercial Addition/Alteration')).toBe('commercial_remodel');
    expect(cat('Tenant Improvement')).toBe('commercial_remodel');
  });
  it('skips trades, roofs, signs, utilities and site work, and reports a new building type', () => {
    for (const t of ['Mechanical permit', 'Plumbing', 'Roof, Residential', 'Sign', 'Sewer Repair', 'Water Connection', 'Fire Alarm', 'Right-of-Way Disturbance',
      'Single-Family Landscape Plan/Tree Removal', 'Demolition, Commercial', 'Fence Permit', 'Retaining Wall (Residential Type 2)', 'Site Civil (Commercial/Multi-Family)']) {
      expect(cat(t), t).toBeNull();
      expect(isUnsortedBuildingType('snohomish_city', t), t).toBe(false);
    }
    expect(isUnsortedBuildingType('snohomish_city', 'Multi-Family New Construction')).toBe(true);
    expect(isUnsortedBuildingType('snohomish_city', 'Townhouse New Construction')).toBe(true);
  });
  it('reads a newer EnerGov site’s permit and its people into the shape the older sites send', async () => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push([init.method || 'GET', new URL(url).pathname]);
      const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
      if (url.endsWith('/api/energov/permits/abc')) return json({ Success: true, Result: { PermitNumber: 'BR26-1', Value: 196859.72, SquareFeet: 1584, Description: 'ADU' } });
      if (url.endsWith('/api/energov/entity/contacts/search/search')) {
        expect(JSON.parse(init.body)).toMatchObject({ EntityId: 'abc', ModuleId: 1 });
        return json({ Success: true, Result: [{ ContactTypeName: 'Owner', GlobalEntityName: '', FirstName: 'Rachel', LastName: 'Jones' }] });
      }
      return new Response('no', { status: 404 });
    };
    const src = createEnergovSource({ name: 'City of Snohomish', tenant: 'T', base: 'https://x.test/apps/SelfService', modern: true, fetchImpl, sleep: async () => {} });
    const d = await src.details('abc');
    expect(d).toMatchObject({ PermitNumber: 'BR26-1', ValuationValue: 196859.72, SquareFeet: 1584, Contacts: [{ ContactTypeName: 'Owner', FirstName: 'Rachel', LastName: 'Jones' }] });
    expect(calls).toEqual([['GET', '/apps/SelfService/api/energov/permits/abc'], ['POST', '/apps/SelfService/api/energov/entity/contacts/search/search']]);
    const p = RULES.snohomish_city.toPermit({ CaseId: 'abc', CaseNumber: 'BR26-1', CaseType: 'Accessory Dwelling Unit', IssueDate: '2026-10-16T15:13:37Z', Address: { AddressLine1: '421', StreetTypeName: 'AVENUE A', UnitOrSuite: '' } }, d);
    expect(p).toMatchObject({ category: 'adu', valuation: 196859.72, sqft: 1584, address: '421 AVENUE A', issuedOn: '2026-10-16' });
    expect(p.contacts).toEqual([expect.objectContaining({ kind: 'owner', name: 'Rachel Jones' })]);
  });
  it('is under the Snohomish filter', () => {
    expect(SOURCES.snohomish_city).toMatchObject({ county: 'snohomish', kind: 'city', readsDetails: true });
  });
});

describe('Monroe', () => {
  const cat = (t, u = '') => categoryFor('monroe', t, u);
  const HEAD = ['Permit No', 'Permit Class', 'Permit Type', 'Permit Description', 'Proposed Use', 'Tax Lot', 'Address', 'Applicant', 'Contractor Name', 'Contractor Phone', 'Issue Date', 'Permit Status', 'Valuation', 'Balance', 'Total Fees'];
  const line = (over = {}) => ['26-ADD-0119', 'Building', 'Addition', 'Expands the office', 'Industrial', '00751800000700', '17350 TYE ST', '2812 Architecture', 'New Vision Construction Inc', '(425) 361-5661', '09/29/2026', 'Inspections Complete', '1529392.35', 0, 4847.04]
    .map((v, i) => (over[HEAD[i]] !== undefined ? over[HEAD[i]] : v));
  const grid = (lines, period = '9/1/2026 - 9/30/2026') => [['Issued Permits '], [period], HEAD, ...lines];

  it('files the city’s building types by their proposed use', () => {
    expect(cat('Building - New Building', 'Single Family Detached')).toBe('new_home');
    expect(cat('Building - New Building', 'Duplex')).toBe('multifamily');
    expect(cat('Building - New Building', 'Retail')).toBe('commercial_new');
    expect(cat('Building - ADU', 'Single Family Detached')).toBe('adu');
    expect(cat('Building - Remodel', 'Single Family Detached')).toBe('remodel');
    expect(cat('Building - Remodel', 'Office/Bank/Professional')).toBe('commercial_remodel');
    expect(cat('Building - Addition', 'Single Family Detached')).toBe('addition');
    expect(cat('Building - Addition', 'Industrial')).toBe('commercial_remodel');
    expect(cat('Building - Remodel', '')).toBe('building_other');
  });
  it('skips trades, roofs, signs, other departments, and reports an unsorted building type or use', () => {
    for (const [t, u] of [['Building - Mechanical', 'Single Family Detached'], ['Building - Re-Roof', 'Retail'], ['Building - Sign', 'Retail'], ['Building - Deck', 'Duplex'],
      ['Building - Garage/Carport', 'Single Family Detached'], ['Engineering - Fence', 'Industrial'], ['Fire - Fire Sprinkler', 'Retail'], ['Planning - Temporary Use', 'Retail']]) {
      expect(cat(t, u), `${t} ${u}`).toBeNull();
      expect(isUnsortedBuildingType('monroe', t, u), `${t} ${u}`).toBe(false);
    }
    expect(isUnsortedBuildingType('monroe', 'Building - Tower', 'Retail')).toBe(true);
    expect(isUnsortedBuildingType('monroe', 'Building - New Building', 'Cannabis')).toBe(true);
  });
  it('lists the reports on the city’s page, newest first', () => {
    const html = '<a href="/DocumentCenter/View/18528/Issued-Permits-Report---May-2026">Issued Permits Report - May 2026</a><a href="/DocumentCenter/View/18936/x">Issued Permits Report - September 2026</a><a href="/DocumentCenter/View/1/x">Council Rules</a>';
    expect(parseMonroeReports(html)).toEqual([
      { id: '18936', title: 'Issued Permits Report - September 2026', url: 'https://monroewa.gov/DocumentCenter/View/18936/x', month: '2026-09' },
      { id: '18528', title: 'Issued Permits Report - May 2026', url: 'https://monroewa.gov/DocumentCenter/View/18528/Issued-Permits-Report---May-2026', month: '2026-05' }
    ]);
  });
  it('adds a permit’s valuation lines into one row, and stops on a changed layout', () => {
    const { rows, period } = monroeReportRows(grid([line(), line({ Valuation: '156000' }), line({ 'Permit No': '26-X', Valuation: '10' })]));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ 'Permit No': '26-ADD-0119', Valuation: 1685392.35 });
    expect(period).toBe('9/1/2026 - 9/30/2026');
    expect(() => monroeReportRows([['x']])).toThrow(/no “Permit No” header/);
    expect(() => monroeReportRows([['Permit No', 'Permit Class']])).toThrow(/no Permit Type/);
  });
  it('copies the row: contractor with phone, applicant, value, no invented dates', () => {
    const p = monroePermit(monroeReportRows(grid([line()])).rows[0]);
    expect(p).toMatchObject({ source: 'monroe', permitNumber: '26-ADD-0119', category: 'commercial_remodel', type: 'Building - Addition', subtype: 'Industrial', issuedOn: '2026-09-29', valuation: 1529392.35, address: '17350 TYE ST', appliedOn: null });
    expect(p.contacts).toEqual([expect.objectContaining({ kind: 'contractor', company: 'New Vision Construction Inc', phone: '(425) 361-5661' }), expect.objectContaining({ kind: 'applicant', company: '2812 Architecture' })]);
    expect(monroePermit(monroeReportRows(grid([line({ Address: 'Parcel: 00834300000100' })])).rows[0]).address).toBe('00834300000100');
  });
  it('reads the months since a day, and stops on a permit from another month or a non-spreadsheet', async () => {
    const sheet = (rows) => {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(grid(rows)), 'Sheet1');
      return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
    };
    const page = '<a href="/DocumentCenter/View/2/x">Issued Permits Report - September 2026</a><a href="/DocumentCenter/View/1/x">Issued Permits Report - August 2026</a>';
    const server = (files) => async (url) => {
      if (url.includes('/1355/')) return new Response(page, { status: 200, headers: { 'content-type': 'text/html' } });
      const f = files[url.match(/View\/(\d+)/)[1]];
      return new Response(f.body, { status: 200, headers: { 'content-type': f.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } });
    };
    const ok = await createMonroeSource({ fetchImpl: server({ 2: { body: sheet([line(), line({ 'Permit No': '26-B', 'Issue Date': '09/05/2026' })]) }, 1: { body: sheet([line({ 'Issue Date': '08/10/2026' })]) } }) }).issuedSince('2026-09-10');
    expect(ok.rows.map((r) => r['Permit No'])).toEqual(['26-ADD-0119']);
    expect(ok.pages).toBe(1);
    await expect(createMonroeSource({ fetchImpl: server({ 2: { body: sheet([line({ 'Issue Date': '10/01/2026' })]) }, 1: { body: sheet([]) } }) }).issuedSince('2026-09-01')).rejects.toThrow(/stopped so nothing is missed/);
    await expect(createMonroeSource({ fetchImpl: server({ 2: { body: '<html>', type: 'text/html' }, 1: { body: '' } }) }).issuedSince('2026-09-01')).rejects.toThrow(/not a spreadsheet/);
  });
  it('is under the Snohomish filter and keeps phones', () => {
    expect(SOURCES.monroe).toMatchObject({ county: 'snohomish', kind: 'city', phones: true });
  });
});
