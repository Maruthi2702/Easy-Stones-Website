import { describe, it, expect } from 'vitest';
import { readConstructConnect, decodeEntities, roleGroup, roleLabel, dayOf, phoneDigits, formatPhone, formatValue, orderCompanies, reachable } from './projectLeads.ts';

const row = (over: Record<string, unknown> = {}) => ({
  'Project Id': '1001689700', 'Project Title': 'Lulac Hacienda Apartments', 'Project Value': '4500000',
  'Project Stage': 'POST BID - Post Bid', 'Project Subcategory': 'Apartments', 'Project Bid Date': '',
  'Project List Date': '8/28/2012 5:42:54 AM', 'Project Last Updated': '10/9/2012 5:42:08 AM',
  'Project Street Address': '2625 Greenwood Dr', 'Project City': 'Corpus Christi', 'Project County': 'Nueces',
  'Project State/Province': 'Texas', 'Project Postal Code': '78405-2172', 'Project Floors': '3',
  'Project Floor Area': '60000', 'Project Floor Area Unit of Measure': 'Square Feet', 'Project Site Area': '4',
  'Project Site Area Unit of Measure': 'Acres', 'Project Stage Comments 1': 'Subbids Closed',
  'Company Id': '2402500', 'Company Name': 'Gonzalez Newell Bender Inc', 'Company Classification/Role': 'Architect',
  'Company Address': '1630 Lockhill Selma Rd', 'Company City': 'San Antonio', 'Company State/Province': 'Texas',
  'Company Postal Code': '78230', 'Company Contact First Name': 'Francisco', 'Company Contact Last Name': 'Gonzalez',
  'Company Phone Number': '2106920331', 'Company Email': 'GNB@gnbarch.com', ...over
});

describe('roleGroup', () => {
  it('sorts the export’s roles into who to call', () => {
    expect(roleGroup('Architect')).toBe('architect');
    expect(roleGroup("Architect's Representative")).toBe('architect');
    expect(roleGroup('Interior Designer')).toBe('designer');
    expect(roleGroup('Owner')).toBe('owner');
    expect(roleGroup('Self-Performing - Developer')).toBe('owner');
    expect(roleGroup('Awarded - General Contractor - Bidder')).toBe('contractor');
    expect(roleGroup('Construction Manager')).toBe('contractor');
    expect(roleGroup('Mechanical and Electrical Engineer')).toBe('other');
    expect(roleGroup('Landscape Architect')).toBe('other');
    expect(roleGroup('Plans Representative')).toBe('other');
  });
});

describe('cells', () => {
  it('reads days, phones and values', () => {
    expect(dayOf('10/3/2012 5:44:38 AM')).toBe('2012-10-03');
    expect(dayOf('')).toBe('');
    expect(dayOf('13/40/2012')).toBe('');
    expect(phoneDigits('1 (206) 555-1234')).toBe('2065551234');
    expect(phoneDigits('555')).toBe('');
    expect(formatPhone('2065551234')).toBe('(206) 555-1234');
    expect(formatValue(4500000)).toBe('$4.5M');
    expect(formatValue(36e8)).toBe('$3.6B');
    expect(formatValue(null)).toBe('—');
    expect(roleLabel('Bidder - General Contractor - Bidder')).toBe('General Contractor (bidder)');
    expect(roleLabel('Awarded - Roofing')).toBe('Roofing (awarded)');
    expect(roleLabel('Architect')).toBe('Architect');
  });
});

describe('readConstructConnect', () => {
  it('makes one project of the repeated rows, with its companies', () => {
    const r = readConstructConnect([
      row(),
      row({ 'Company Id': '9', 'Company Name': 'Acme Builders', 'Company Classification/Role': 'Owner', 'Company Email': 'not an email', 'Company Phone Number': '' })
    ]);
    expect(r.problems).toEqual([]);
    expect(r.projects).toHaveLength(1);
    const p = r.projects[0];
    expect(p).toMatchObject({ id: '1001689700', value: 4500000, stage: 'Post Bid', state: 'Texas', updatedOn: '2012-10-09', listedOn: '2012-08-28', floors: 3, floorArea: 60000 });
    expect(p.companies.map(c => [c.name, c.group, c.email, c.phone])).toEqual([
      ['Gonzalez Newell Bender Inc', 'architect', 'gnb@gnbarch.com', '2106920331'],
      ['Acme Builders', 'owner', '', '']
    ]);
  });
  it('keeps a company once when its row repeats, but twice for two roles', () => {
    const r = readConstructConnect([row(), row(), row({ 'Company Classification/Role': 'Owner' })]);
    expect(r.projects[0].companies).toHaveLength(2);
  });
  it('adds units and owner type from the Custom sheet by title and street', () => {
    const r = readConstructConnect([row()], [{ 'Project Title': 'LULAC Hacienda Apartments', 'Street Address': '2625 greenwood dr', Units: '60', 'Owner Type': 'Private' }]);
    expect(r.projects[0]).toMatchObject({ units: 60, ownerType: 'Private' });
  });
  it('reads the export\'s HTML-escaped names as typed', () => {
    expect(decodeEntities('Gorman &amp; Company Inc.')).toBe('Gorman & Company Inc.');
    expect(decodeEntities('M&amp;P &#39;Co&#x27; &lt;3 &unknown;')).toBe("M&P 'Co' <3 &unknown;");
    expect(decodeEntities('&amp;amp;')).toBe('&amp;');
    const [p] = readConstructConnect([row({ 'Project Title': 'Smith &amp; Sons Lofts', 'Company Name': 'M&amp;P Construction Inc' })]).projects;
    expect(p.title).toBe('Smith & Sons Lofts');
    expect(p.companies[0].name).toBe('M&P Construction Inc');
  });
  it('skips rows with no project id and refuses a file that is not the export', () => {
    expect(readConstructConnect([row(), row({ 'Project Id': '' })]).skippedRows).toBe(1);
    const bad = readConstructConnect([{ Name: 'x' }]);
    expect(bad.projects).toEqual([]);
    expect(bad.problems[0]).toMatch(/isn't the ConstructConnect export/);
    expect(readConstructConnect([]).problems[0]).toMatch(/empty/);
  });
  it('puts owners first and offers only people with a phone or email', () => {
    const [p] = readConstructConnect([row(), row({ 'Company Id': '9', 'Company Name': 'Acme', 'Company Classification/Role': 'Owner' }),
      row({ 'Company Id': '8', 'Company Name': 'Eng Co', 'Company Classification/Role': 'Civil Engineer' })]).projects;
    expect(orderCompanies(p.companies).map(c => c.name)).toEqual(['Acme', 'Gonzalez Newell Bender Inc', 'Eng Co']);
    expect(p.companies.filter(reachable).map(c => c.name)).toEqual(['Gonzalez Newell Bender Inc', 'Acme']);
  });
});

import { customerPrefillForCompany, updatedFromFor, formatDayShort, leadExportRows } from './projectLeads.ts';

describe('screen helpers', () => {
  const p = { id: '1', title: 'Lulac Hacienda', city: 'Corpus Christi', state: 'Texas' };
  const c = { companyId: '1', name: 'ACME BUILDERS INC', role: 'Awarded - General Contractor - Bidder', group: 'contractor' as const, address: '1 MAIN ST', city: 'AUSTIN', state: 'Texas', zip: '78701-1234', firstName: 'ann', lastName: 'LEE', phone: '2065551234', email: 'ann@acme.test' };
  it('opens Add customer filled in from a company on a project', () => {
    expect(customerPrefillForCompany(p, c)).toEqual({
      company: 'Acme Builders Inc', customerName: 'Ann Lee', phone: '(206) 555-1234', email: 'ann@acme.test', marketingEmail: 'ann@acme.test',
      address: { street: '1 Main St', city: 'Austin', state: 'Texas', zipCode: '78701' }, customerType: 'Contractor', status: 'New Lead',
      notes: 'General Contractor (awarded) on “Lulac Hacienda” (Corpus Christi, Texas) · Added from Multifamily Leads'
    });
    expect(customerPrefillForCompany(p, { ...c, group: 'other' })).not.toHaveProperty('customerType');
  });
  it('turns an Updated preset into a day', () => {
    expect(updatedFromFor('90', new Date(2026, 10, 20))).toBe('2026-08-22');
    expect(updatedFromFor('all', new Date(2026, 10, 20))).toBe('');
    expect(formatDayShort('2026-06-25')).toBe('Jun 25, 2026');
    expect(formatDayShort('')).toBe('—');
  });
  it('exports a row per company, or one row for a project with none', () => {
    const base = { ...p, value: 5e6, stage: 'Post Bid', subcategory: 'Apartments', bidDate: '', listedOn: '', updatedOn: '2026-06-01', address: '', county: '', zip: '', floors: null, floorArea: null, floorAreaUnit: '', siteArea: null, siteAreaUnit: '', stageNote: '', units: 40, ownerType: '', status: 'contacted' as const, assignedTo: 'Sam' };
    const rows = leadExportRows([{ ...base, companies: [c] }, { ...base, id: '2', title: 'Empty', companies: [] }]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ Project: 'Lulac Hacienda', Company: 'ACME BUILDERS INC', Contact: 'ann LEE', Phone: '(206) 555-1234', 'Lead Status': 'Contacted', 'Assigned To': 'Sam' });
    expect(rows[1]).toMatchObject({ Project: 'Empty', Company: '' });
  });
});

import { statesSummary } from './projectLeads.ts';
describe('statesSummary', () => {
  it('says what the closed States dropdown holds', () => {
    expect(statesSummary([])).toBe('All states');
    expect(statesSummary(['Texas'])).toBe('Texas');
    expect(statesSummary(['Texas', 'Washington'])).toBe('Texas + Washington');
    expect(statesSummary(['Texas', 'Washington', 'Oregon'])).toBe('3 states');
  });
});
