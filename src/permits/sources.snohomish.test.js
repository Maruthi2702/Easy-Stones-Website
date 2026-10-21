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
    expect(sourcesInCounties(['snohomish'])).toEqual(['snohomish_county', 'edmonds', 'marysville']);
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
