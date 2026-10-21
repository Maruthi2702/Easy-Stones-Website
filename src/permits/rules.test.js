// Every source's rules (src/permits/rules/), checked against trimmed real
// records from 2026-10-14: which exact types are leads, what's skipped, what
// gets reported as a new type, and how each record copies into a permit.
// Plus the contract every source must keep, so a new one can't be half-wired.
import { describe, it, expect } from 'vitest';
import {
  RULES, SOURCES, SOURCE_IDS, COVERED_COUNTY_IDS, CATEGORY_IDS, categoryFor, isUnsortedBuildingType, sourcesInCounties,
  dayOf, htmlText, licenseKey, money, tidyContacts
} from './permitRules.js';
import { STATES, COUNTIES, COUNTY_IDS, countyLabel } from './places.js';
import { seattlePermit, seattleLicense } from './rules/seattle.js';
import { mbpPermit, mbpDay, mbpPermitUrl } from './rules/mbp.js';
import {
  kingType, parseKingReports, kingReportRows, reconcileKingReport, kingReportFill, titleCase, splitNameAddress, kingReportPermit
} from './rules/kingCounty.js';
import bellevue, { bellevueCategory, bellevueFill } from './rules/bellevue.js';
import { shorelinePermit } from './rules/shoreline.js';
import { energovPermit } from './rules/whatcom.js';
import { parseMbpDetail, mbpDate } from './sources/mbp.js';

describe('the sources', () => {
  it('each keeps the contract the pull, API and screen rely on', () => {
    for (const id of SOURCE_IDS) {
      const r = RULES[id];
      expect(r.id).toBe(id);
      for (const k of ['label', 'long', 'issuer', 'contactsNote', 'county']) expect(typeof r[k], `${id}.${k}`).toBe('string');
      for (const f of ['typeOf', 'categoryFor', 'isUnsorted', 'typeLabel', 'issuedDayOf', 'numberOf', 'toPermit', 'emptyError']) {
        expect(typeof r[f], `${id}.${f}`).toBe('function');
      }
      // A source that reads details names the id to read them by and what to say when none open.
      if (r.detailIdOf) expect(typeof r.detailsError, `${id}.detailsError`).toBe('function');
      expect(COUNTY_IDS, `${id}'s county`).toContain(r.county);
      expect(SOURCES[id]).toMatchObject({ id, county: r.county, countyLabel: countyLabel(r.county) });
    }
  });

  it('lists King County’s sources first, the county office before its cities', () => {
    expect(SOURCE_IDS).toEqual([
      'king_county', 'auburn', 'bellevue', 'burien', 'issaquah', 'kenmore', 'kirkland', 'mercer_island', 'renton', 'sammamish', 'seattle', 'shoreline', 'snoqualmie',
      'snohomish_county', 'edmonds', 'marysville',
      'whatcom', 'bellingham'
    ]);
    expect(SOURCES.king_county.kind).toBe('county');
    expect(SOURCES.seattle.kind).toBe('city');
  });

  it('knows which counties are covered and which sources are in them', () => {
    expect(COVERED_COUNTY_IDS).toEqual(['king', 'snohomish', 'whatcom']);
    expect(sourcesInCounties(['snohomish'])).toEqual(['snohomish_county', 'edmonds', 'marysville']);
    expect(sourcesInCounties(['whatcom'])).toEqual(['whatcom', 'bellingham']);
    expect(sourcesInCounties(['king'])).toHaveLength(13);
    expect(sourcesInCounties([])).toEqual(SOURCE_IDS);
    expect(sourcesInCounties(['adams'])).toEqual([]);
  });

  it('lists all 39 Washington counties', () => {
    expect(STATES[0].name).toBe('Washington');
    expect(COUNTIES).toHaveLength(39);
    expect(COUNTIES.find((c) => c.name === 'Grays Harbor').id).toBe('grays_harbor');
    expect(countyLabel('king')).toBe('King County');
    expect(countyLabel('nowhere')).toBe('');
  });

  it('only files permits under real categories', () => {
    const cats = new Set();
    for (const id of SOURCE_IDS) {
      for (const t of ['', 'BUILDING', 'Residential - New', 'BS', 'Building/Residential Building/Dwelling-Single/NA']) {
        const c = categoryFor(id, t, 'New');
        if (c) cats.add(c);
      }
    }
    for (const c of cats) expect(CATEGORY_IDS).toContain(c);
  });
});

describe('shared text and numbers', () => {
  it('reads US dates, Date objects and ASP.NET dates as the same calendar day', () => {
    expect(dayOf('10/13/2026')).toBe('2026-10-13');
    expect(dayOf('9/1/2026')).toBe('2026-09-01');
    expect(dayOf(new Date('2026-09-16T07:00:00Z'))).toBe('2026-09-16');
    expect(dayOf('2026-10-12T00:00:00.000')).toBe('2026-10-12');
    expect(dayOf('13/45/2026')).toBeNull();
    expect(mbpDay('/Date(1791874800000)/')).toBe('2026-10-13');
    // 4:30 PM Pacific on Oct 6 is Oct 7 in UTC — still Oct 6.
    expect(mbpDay(`/Date(${Date.parse('2026-10-06T16:30:00-07:00')})/`)).toBe('2026-10-06');
    expect(mbpDay(null)).toBeNull();
  });

  it('turns HTML descriptions into plain text', () => {
    expect(htmlText('KINGEN RESIDENCE<BR>Remodel two bathrooms &amp; one sink.')).toBe('KINGEN RESIDENCE · Remodel two bathrooms & one sink.');
    expect(htmlText('Project Name: Timber Trails<BR><BR>Building 12')).toBe('Project Name: Timber Trails · Building 12');
    expect(htmlText('<BR>')).toBe('');
  });

  it('recognises a WA contractor license number', () => {
    expect(licenseKey('brocksc921mj')).toBe('BROCKSC921MJ');
    expect(licenseKey('VIVIDDL801B4')).toBe('VIVIDDL801B4');
    expect(licenseKey('')).toBe('');
    expect(licenseKey('NONE')).toBe('');
    expect(licenseKey('12345678')).toBe('');
  });

  it('reads money and counts sent as text', () => {
    expect(money('447600.0000')).toBe(447600);
    expect(money('0')).toBeNull();
    expect(money('')).toBeNull();
  });

  it('keeps a contractor known only by license number', () => {
    expect(tidyContacts([{ role: 'Contractor', company: '', license: 'INFINRL757P2' }])).toEqual([
      { role: 'Contractor', kind: 'contractor', company: '', name: '', phone: '', email: '', address: '', license: 'INFINRL757P2' }
    ]);
    expect(tidyContacts([{ role: 'Contractor', company: '' }])).toEqual([]);
  });
});

describe('Seattle', () => {
  const ROW = {
    permitnum: '7116062-CN', permitclass: 'Single Family/Duplex', permittypemapped: 'Building', permittypedesc: 'New',
    description: 'Construct new two family dwelling  per plan.', housingunitsadded: '1.0', estprojectcost: '447600.0000',
    applieddate: '2025-12-23T00:00:00.000', issueddate: '2026-10-12T00:00:00.000', expiresdate: '2028-04-12T00:00:00.000',
    statuscurrent: 'Issued', originaladdress1: '1526 M L KING JR WAY', originalcity: 'SEATTLE', originalzip: '98122',
    contractorcompanyname: 'Vivid Development LLC', link: { url: 'https://services.seattle.gov/portal/customize/LinkToRecord.aspx?altId=7116062-CN' }
  };

  it('sorts by the building’s class and the kind of work', () => {
    expect(categoryFor('seattle', 'Single Family/Duplex', 'New')).toBe('new_home');
    expect(categoryFor('seattle', 'Single Family/Duplex', 'Addition/Alteration')).toBe('remodel');
    expect(categoryFor('seattle', 'Multifamily', 'New')).toBe('multifamily');
    expect(categoryFor('seattle', 'Commercial', 'Tenant Improvment')).toBe('commercial_remodel');
    expect(categoryFor('seattle', 'Institutional', 'New')).toBe('commercial_new');
    expect(categoryFor('seattle', 'Commercial', 'Temporary')).toBeNull();
    expect(categoryFor('seattle', 'Vacant Land', 'New')).toBeNull();
  });

  it('reports a new kind of building work, not temporary or paperwork-only ones', () => {
    expect(isUnsortedBuildingType('seattle', 'Single Family/Duplex', 'Relocation')).toBe(true);
    expect(isUnsortedBuildingType('seattle', 'Commercial', 'Change of Use Only - No Construction')).toBe(false);
    expect(isUnsortedBuildingType('seattle', 'Vacant Land', 'Addition/Alteration')).toBe(false);
  });

  it('copies a permit exactly, the contractor’s license from its page', () => {
    const p = seattlePermit(ROW, { license: 'VIVIDDL801B4' });
    expect(p).toMatchObject({
      source: 'seattle', permitNumber: '7116062-CN', category: 'new_home', type: 'Single Family/Duplex', subtype: 'New',
      issuedOn: '2026-10-12', appliedOn: '2025-12-23', city: 'Seattle', zip: '98122', valuation: 447600, units: 1,
      sourceUrl: ROW.link.url
    });
    expect(p.contacts).toEqual([{ role: 'Contractor', kind: 'contractor', company: 'Vivid Development LLC', name: '', phone: '', email: '', address: '', license: 'VIVIDDL801B4' }]);
  });

  it('leaves contacts unset without the page, so a save keeps the ones read before', () => {
    expect(seattlePermit(ROW, null).contacts).toBeUndefined();
  });

  it('finds the contractor’s license on the portal page', () => {
    const html = `<span class='ACA_SmLabelBolder font11px'>Contractor License: </span>\n</div>\n<div class='x'>\n<span class='y'>VIVIDDL801B4</span>`;
    expect(seattleLicense(html)).toBe('VIVIDDL801B4');
    expect(seattleLicense('<html>no contractor here</html>')).toBe('');
  });
});

describe('King County', () => {
  const ROW = {
    Jurisdiction: 'King County', PermitNumber: 'ADDC25-0739', PermitDescription: 'Construction of a single story, detached workshop',
    Address: '6400   NORTH FORK RD SE', PermitType: 'Building/Residential Building/Addition-Improvement', PermitStatus: 'Permit Issued',
    AppliedDate: '/Date(1763712000000)/', IssuedDate: '/Date(1789542000000)/', FinaledDate: null
  };

  it('compares types without the county’s “/NA” tails', () => {
    expect(kingType('Building/Residential Building/Dwelling-Single/NA')).toBe('Building/Residential Building/Dwelling-Single');
    expect(kingType('Building/Mechanical/Residential/NA')).toBe('Building/Mechanical/Residential');
    expect(categoryFor('king_county', 'Building/Residential Building/Dwelling-Single/NA')).toBe('new_home');
    expect(categoryFor('king_county', 'Building/Residential Building/Addition-Improvement')).toBe('remodel');
    expect(categoryFor('king_county', 'Building/Residential Building/Dwelling-ADU/NA')).toBe('adu');
    expect(categoryFor('king_county', 'Building/Addition-Improvement/Tenant/NA')).toBe('commercial_remodel');
    expect(categoryFor('king_county', 'Building/Mechanical/Residential/NA')).toBeNull();
  });

  it('reports new building types, never trades, inspections or records', () => {
    expect(isUnsortedBuildingType('king_county', 'Building/Residential Building/Treehouse/NA')).toBe(true);
    expect(isUnsortedBuildingType('king_county', 'Building/Mechanical/Commercial/NA')).toBe(false);
    expect(isUnsortedBuildingType('king_county', 'Building/Residential Building/Dwelling-Mobile/NA')).toBe(false);
    expect(isUnsortedBuildingType('king_county', 'Fire/Fire Permit Systems/Alarm/NA')).toBe(false);
  });

  it('copies a permit with its people, parcel and the parcel’s city', () => {
    const p = mbpPermit(RULES.king_county, ROW, {
      people: [{ Name: 'Carrie Miranda', ContractorLicNum: '', Type: 'Applicant' }, { Name: 'Carrie Miranda', ContractorLicNum: 'BROCKSC921MJ', Type: 'Contractor' }],
      parcel: '2624089001', projectName: '(PRO)TRAUT WORKSHOP', place: { city: 'Snoqualmie', zip: '98065' }
    });
    expect(p).toMatchObject({
      source: 'king_county', permitNumber: 'ADDC25-0739', category: 'remodel', status: 'Permit Issued', issuedOn: '2026-09-16', appliedOn: '2025-11-21',
      address: '6400 NORTH FORK RD SE', city: 'Snoqualmie', zip: '98065', parcel: '2624089001', projectName: '(PRO)TRAUT WORKSHOP',
      sourceUrl: 'https://permitsearch.mybuildingpermit.com/PermitDetails/ADDC25-0739/KING%20COUNTY'
    });
    expect(p.contacts[0]).toMatchObject({ kind: 'contractor', company: 'Carrie Miranda', license: 'BROCKSC921MJ' });
  });

  it('leaves the detail fields unset when the details didn’t load', () => {
    const p = mbpPermit(RULES.king_county, ROW, null);
    expect(p.contacts).toBeUndefined();
    expect(p.city).toBeUndefined();
    expect(p.parcel).toBeUndefined();
  });

  it('finds the monthly spreadsheets on the county’s page', () => {
    const html = `<a href="https://cdn.kingcounty.gov/-/media/king-county/depts/local-services/permits/reports/king-county-issued-permits-2026-09.xlsx?rev=1&amp;hash=2">Sept</a>
      <a href="/-/media/king-county/depts/local-services/permits/reports/kingcounty-issued-permits-2026-06.xlsx">June</a>
      <a href="/-/media/x/king-county-new-applications-2026-09.xlsx">apps</a>`;
    const r = parseKingReports(html, 'https://kingcounty.gov/en/reports');
    expect(r.map((x) => x.month)).toEqual(['2026-09', '2026-06']);
    expect(r[0].url).toBe('https://cdn.kingcounty.gov/-/media/king-county/depts/local-services/permits/reports/king-county-issued-permits-2026-09.xlsx?rev=1&hash=2');
    expect(r[1].url).toBe('https://kingcounty.gov/-/media/king-county/depts/local-services/permits/reports/kingcounty-issued-permits-2026-06.xlsx');
  });

  const GRID = [
    ['King County Department of Local Services - Permitting \nIssued Permits Report', null],
    [], [], [],
    ['PERMIT NBR', 'PERMIT TYPE', 'PROJECT NAME', 'DETAIL DESCRIPTION', 'INTAKE COMPLETE DT', 'READY TO iSSU', 'ISSUED DATE', 'RECORD STATUS', 'JOB VALUE', 'PARCEL', 'SITE ADDRESS/LOCATION', 'Subarea', 'PRIMARY ADDRESS', 'APPLICANT NAME & ADDRESS', 'OWNER NAME & ADDRESS', 'DWEL UNITS'],
    ['ADDC24-0028', 'Building/Residential Building/Addition-Improvement/NA', 'BEHLULI GARAGE ADDITION', 'CONSTRUCT GARAGE', null, null, new Date('2026-09-17T07:00:00Z'), 'Permit Issued', 344212.8, '1593001020', null, 'r', '10121 420TH AVE SE, NORTH BEND, WA 98045', 'Faruk Behluli', 'Faruk Behluli', null],
    ['MECH26-1673', 'Building/Mechanical/Residential/NA', '', '', null, null, new Date('2026-09-16T07:00:00Z'), 'Permit Issued', 0, '', null, '', '1 MAIN ST, KENT, WA 98030', '', '', null],
    ['SFR26-0001', 'Building/Residential Building/Dwelling-Single/NA', 'NEW HOUSE', '', null, null, new Date('2026-09-20T07:00:00Z'), 'Permit Issued', 650000, '2624089001', null, '', '6400 NORTH FORK RD SE, SNOQUALMIE, WA 98065-1234', '', '', 1],
    [null, null]
  ];

  it('reads the report’s rows by their column titles', () => {
    const rows = kingReportRows(GRID);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      number: 'ADDC24-0028', type: 'Building/Residential Building/Addition-Improvement/NA', project: 'BEHLULI GARAGE ADDITION', description: 'CONSTRUCT GARAGE',
      status: 'Permit Issued', appliedOn: null, applicant: 'Faruk Behluli', owner: 'Faruk Behluli', address: '10121 420TH AVE SE, NORTH BEND, WA 98045',
      issuedOn: '2026-09-17', valuation: 344212.8, parcel: '1593001020', city: 'North Bend', zip: '98045', units: null
    });
    expect(rows[2]).toMatchObject({ city: 'Snoqualmie', zip: '98065', units: 1 });
  });

  it('fails when the report’s columns aren’t there', () => {
    expect(() => kingReportRows([['SOMETHING ELSE']])).toThrow(/PERMIT NBR/);
    expect(() => kingReportRows([['PERMIT NBR', 'PERMIT TYPE']])).toThrow(/ISSUED DATE/);
  });

  it('checks a month both ways, ignoring report permits that aren’t leads', () => {
    const rows = kingReportRows(GRID);
    expect(reconcileKingReport({ month: '2026-09', rows, appInMonth: ['ADDC24-0028', 'SFR26-0001'], appHas: ['ADDC24-0028', 'SFR26-0001'] }))
      .toMatchObject({ ok: true, inReport: 3, leadsInReport: 2, matched: 2, missingFromApp: [], notInReport: [] });
    expect(reconcileKingReport({ month: '2026-09', rows, appInMonth: ['ADDC24-0028', 'XYZ26-9'], appHas: ['ADDC24-0028'] }))
      .toMatchObject({ ok: false, matched: 1, missingFromApp: ['SFR26-0001'], notInReport: ['XYZ26-9'] });
  });

  it('fills in only what the app’s copy is missing', () => {
    const [row] = kingReportRows(GRID);
    expect(kingReportFill(row, { valuation: null, city: '', zip: '', parcel: '', projectName: '' }))
      .toEqual({ valuation: 344212.8, city: 'North Bend', zip: '98045', parcel: '1593001020', projectName: 'BEHLULI GARAGE ADDITION' });
    expect(kingReportFill(row, { valuation: 1, city: 'Kent', zip: '1', parcel: '1', projectName: 'x' })).toEqual({});
  });

  it('adds a lead only the report has, from the report’s own fields', () => {
    expect(splitNameAddress('Faruk Behluli, 10121 420th Ave Se\nNorth Bend, WA 98045')).toEqual({ name: 'Faruk Behluli', address: '10121 420th Ave Se, North Bend, WA 98045' });
    expect(splitNameAddress('Renee & Brian Sonnichsen 10321 428TH AVE SE   NORTH BEND WA 98045')).toEqual({ name: 'Renee & Brian Sonnichsen', address: '10321 428TH AVE SE NORTH BEND WA 98045' });
    expect(splitNameAddress('')).toEqual({ name: '', address: '' });
    const [row] = kingReportRows(GRID);
    const p = kingReportPermit({ ...row, owner: 'Faruk Behluli, 10121 420th Ave Se\nNorth Bend, WA 98045' });
    expect(p).toMatchObject({
      source: 'king_county', permitNumber: 'ADDC24-0028', category: 'remodel', type: 'Building/Residential Building/Addition-Improvement',
      address: '10121 420TH AVE SE', city: 'North Bend', zip: '98045', valuation: 344212.8, issuedOn: '2026-09-17', sourceUrl: ''
    });
    expect(p.contacts.map((c) => [c.kind, c.name])).toEqual([['owner', 'Faruk Behluli'], ['applicant', 'Faruk Behluli']]);
    expect(kingType('Building/New Commercial Construction/Undeveloped/N')).toBe('Building/New Commercial Construction/Undeveloped');
  });

  it('title-cases the county’s upper-case city names', () => {
    expect(titleCase('NORTH BEND')).toBe('North Bend');
  });
});

describe('the cities on MyBuildingPermit', () => {
  it('sorts each city by its own exact type names', () => {
    expect(categoryFor('burien', 'Residential - New')).toBe('new_home');
    expect(categoryFor('burien', 'Residential - Remodel')).toBe('remodel');
    expect(categoryFor('burien', 'Residential - Re-Roof')).toBeNull();
    expect(categoryFor('sammamish', 'BLDG RESIDENTIAL - ADU DETACHED')).toBe('adu');
    expect(categoryFor('sammamish', 'BLDG COMMERCIAL - REMODEL/TI')).toBe('commercial_remodel');
    expect(categoryFor('kenmore', 'SINGLE FAMILY ADDITION AND ALTERATION')).toBe('addition');
    expect(categoryFor('auburn', 'Tenant Improvement')).toBe('commercial_remodel');
    expect(categoryFor('auburn', 'CONSTRUCTION')).toBeNull();
  });

  it('files a city’s broad types as Other building', () => {
    expect(categoryFor('issaquah', 'BUILDING')).toBe('building_other');
    expect(categoryFor('kirkland', 'BSF')).toBe('building_other');
    expect(categoryFor('mercer_island', 'ADU')).toBe('adu');
    expect(categoryFor('snoqualmie', 'RESIDENTIAL')).toBe('building_other');
  });

  it('reports a city’s new building types, never its trades', () => {
    expect(isUnsortedBuildingType('burien', 'Residential - Pool')).toBe(true);
    expect(isUnsortedBuildingType('burien', 'Residential - Electric')).toBe(false);
    expect(isUnsortedBuildingType('sammamish', 'BLDG RESIDENTIAL - TINY HOME')).toBe(true);
    expect(isUnsortedBuildingType('sammamish', 'ELECTRICAL - RESIDENTIAL ELECTRICAL')).toBe(false);
    expect(isUnsortedBuildingType('kirkland', 'BAC')).toBe(true);   // a new B… (building) code
    expect(isUnsortedBuildingType('kirkland', 'ESF')).toBe(false);  // electrical, single family
    expect(isUnsortedBuildingType('kirkland', 'BNO')).toBe(false);  // Building Not Occupied: docks, gates, walls — skipped
    expect(categoryFor('kirkland', 'BNO')).toBeNull();
  });

  it('puts every city permit in its city', () => {
    const p = mbpPermit(RULES.burien, { PermitNumber: 'BLD26-2486', PermitType: 'Residential - Remodel', Address: '2108 SW 149TH ST', IssuedDate: '/Date(1791961200000)/' }, null);
    expect(p).toMatchObject({ city: 'Burien', category: 'remodel', issuedOn: '2026-10-14' });
    expect(mbpPermitUrl('26 123874 BT', 'BELLEVUE')).toBe('https://permitsearch.mybuildingpermit.com/PermitDetails/26%20123874%20BT/BELLEVUE');
  });

  it('reads the parcel and project name off a permit’s page', () => {
    const html = `<tr><th class="col-lg-4">Project Name:</th>\n<td>(PRO)TRAUT WORKSHOP [FIRE SPRINKLERS]</td></tr><tr><th>Parcel:</th>\n<td>2624089001</td></tr>`;
    expect(parseMbpDetail(html)).toEqual({ parcel: '2624089001', projectName: '(PRO)TRAUT WORKSHOP [FIRE SPRINKLERS]' });
    expect(parseMbpDetail('<html></html>')).toEqual({ parcel: '', projectName: '' });
    expect(mbpDate('2026-09-01')).toBe('09/01/2026');
  });
});

describe('Bellevue', () => {
  const ROW = { PermitNumber: '23 126063 BS', PermitType: 'BS', Address: '12887   SE 43rd Cir', PermitStatus: 'Issued', IssuedDate: '/Date(1791356400000)/' };
  const RECORD = {
    PERMITNUMBER: '23 126063 BS', PERMITTYPE: 'BS', PERMITTYPEDESCRIPTION: 'Single Family New', SUBTYPE: 'Single Family Residential',
    ZIPCODE: '98006223', VALUATION: 512000, SQFOOTAGE1: 2400, DWELLINGUNITSCREATED: 2, OWNER: 'Holy Cross Housing', EXPIREDATE: '2029-10-06'
  };

  it('sorts its codes, the big projects by the building’s kind', () => {
    expect(bellevueCategory('BS')).toBe('new_home');
    expect(bellevueCategory('BU')).toBe('remodel');
    expect(bellevueCategory('BT')).toBe('building_other');
    expect(bellevueCategory('BB', 'Multifamily Residential')).toBe('multifamily');
    expect(bellevueCategory('BB', 'Nonresidential')).toBe('commercial_new');
    expect(bellevueCategory('BF')).toBeNull();
    expect(isUnsortedBuildingType('bellevue', 'BX')).toBe(true);
    expect(isUnsortedBuildingType('bellevue', 'BK')).toBe(false);
  });

  it('adds the city’s own record — value, owner, units — to MyBuildingPermit’s', () => {
    const p = bellevue.toPermit(ROW, { people: [{ Name: 'ABC HOMES', ContractorLicNum: 'ABCHOHL123AB', Type: 'Contractor' }], parcel: '1624059069', projectName: 'BLDG 6', record: RECORD });
    expect(p).toMatchObject({
      source: 'bellevue', category: 'new_home', type: 'Single Family New (BS)', subtype: 'Single Family Residential', city: 'Bellevue',
      zip: '98006', valuation: 512000, sqft: 2400, units: 2, issuedOn: '2026-10-07'
    });
    expect(p.contacts.map((c) => [c.kind, c.company])).toEqual([['contractor', 'ABC HOMES'], ['owner', 'Holy Cross Housing']]);
    expect(bellevueFill(null)).toEqual({});
  });

  it('keeps MyBuildingPermit’s copy when the city has no record yet', () => {
    const p = bellevue.toPermit(ROW, { people: [], parcel: '', projectName: '', record: null });
    expect(p).toMatchObject({ type: 'BS', category: 'new_home', valuation: undefined });
  });

  it('never overwrites a big project’s category without the city’s record', () => {
    const big = { ...ROW, PermitNumber: '25 120925 BB', PermitType: 'BB' };
    expect(bellevue.toPermit(big, null)).toMatchObject({ category: undefined, categoryIfNew: 'commercial_new' });
    expect(bellevue.toPermit(big, { people: [], record: { ...RECORD, PERMITTYPE: 'BB', SUBTYPE: 'Multifamily Residential' } }).category).toBe('multifamily');
  });
});

describe('Renton and Shoreline', () => {
  it('files Renton’s broad building types as Other building, with phone and email contacts', () => {
    expect(categoryFor('renton', 'Building - Residential')).toBe('building_other');
    expect(categoryFor('renton', 'Building - Demolition')).toBeNull();
    expect(isUnsortedBuildingType('renton', 'Building - Pools')).toBe(true);
    expect(isUnsortedBuildingType('renton', 'Residential Electrical Permit')).toBe(false);
    const p = energovPermit(RULES.renton,
      { CaseId: 'abc', CaseNumber: 'B26004657', CaseType: 'Building - Commercial', CaseWorkclass: 'COMMERCIAL', IssueDate: '2026-10-14T15:57:04', Address: { City: 'Renton' } },
      { Description: 'TI', ValuationValue: 35105, Contacts: [{ ContactTypeName: 'Contractor', GlobalEntityName: 'Opal Energy', Phone: '8666926725' }] });
    expect(p).toMatchObject({ source: 'renton', category: 'building_other', issuedOn: '2026-10-14', valuation: 35105, sourceUrl: 'https://permitting.rentonwa.gov/#/permit/abc' });
    expect(p.contacts[0]).toMatchObject({ kind: 'contractor', phone: '8666926725' });
  });

  it('copies a Shoreline export row', () => {
    const p = shorelinePermit({
      'PERMIT NUMBER': 'COM26-0989', 'APPLIED DATE': '04/28/2026', 'ISSUED DATE': '10/13/2026', 'Permit Type': 'COMMERCIAL', PARCEL: '6163900780',
      ADDRESS: '17537 15TH AVE NE STE B', 'OWNER NAME': 'COTTON BUILDING LLC', 'APPLICANT NAME': 'VALLE WORKS', 'CONTRACTOR NAME': 'ELKO CONSTRUCTION LLC', RECORDID: 'MS:26'
    });
    expect(p).toMatchObject({ source: 'shoreline', category: 'building_other', issuedOn: '2026-10-13', appliedOn: '2026-04-28', city: 'Shoreline', parcel: '6163900780' });
    expect(p.contacts.map((c) => c.kind)).toEqual(['contractor', 'owner', 'applicant']);
    expect(categoryFor('shoreline', 'RESIDENTIAL INTERIOR REMODEL ONLINE')).toBe('remodel');
    expect(categoryFor('shoreline', 'RESIDENTIAL REROOF ONLINE')).toBeNull();
    expect(isUnsortedBuildingType('shoreline', 'ADU-DETACHED')).toBe(true);
    expect(isUnsortedBuildingType('shoreline', 'MECHANICAL OR PLUMBING ONLINE')).toBe(false);
  });
});
