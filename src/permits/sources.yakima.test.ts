import type { Loose } from '../types/records.ts';
// Yakima: how the city's "Issued Permits for New Buildings" report (SmartGov
// Community, checked 2026-11-01) becomes leads, and the reader against a fake
// portal and report server (the runner is the one Anacortes uses).
import { describe, it, expect } from 'vitest';
import yakima, { yakimaPermit, yakimaRows, applicantContacts, reportDay } from './rules/yakima.ts';
import { RULES, SOURCES, categoryFor, isUnsortedBuildingType, sourcesInCounties } from './permitRules.ts';
import { createYakimaSource } from './sources/yakima.ts';
import { dateFilter } from './sources/smartgovReport.ts';
import { createPermitReaders } from './readers.ts';

const ROW = { number: 'B260590', address: '5800 SCENIC DR', applicant: 'MODERN STRUCTURES LLC - LILIENTHAL, RICHARD', issuedOn: '2026-09-03', type: 'Residential-Single-Family-New', description: 'New common wall single family residence.' };

describe('Yakima rules', () => {
  it('is in Yakima County, as a city', () => {
    expect(RULES.yakima).toBe(yakima);
    expect(SOURCES.yakima).toMatchObject({ county: 'yakima', kind: 'city' });
    expect(sourcesInCounties(['yakima'])).toEqual(['yakima']);
  });
  it('sorts the city’s new-building types and reports one nobody has sorted', () => {
    expect(categoryFor('yakima', 'Residential-Single-Family-New')).toBe('new_home');
    expect(categoryFor('yakima', 'Residential-Single Family Master Plan')).toBe('new_home');
    expect(categoryFor('yakima', 'Residential-Duplex')).toBe('multifamily');
    expect(categoryFor('yakima', 'Residential-Duplex Master Plan')).toBe('multifamily');
    expect(categoryFor('yakima', 'Residential-Multi-Family-New')).toBe('multifamily');
    expect(categoryFor('yakima', 'Commercial Building New')).toBe('commercial_new');
    expect(isUnsortedBuildingType('yakima', 'Residential-Single-Family-New')).toBe(false);
    expect(isUnsortedBuildingType('yakima', 'Residential-Accessory-Dwelling')).toBe(true);
    expect(isUnsortedBuildingType('yakima', 'Commercial Building Addition')).toBe(true);
  });
  it('copies a permit as the report prints it', () => {
    expect(yakimaPermit(ROW)).toMatchObject({
      source: 'yakima', permitNumber: 'B260590', category: 'new_home', type: 'Residential-Single-Family-New', status: 'Issued', issuedOn: '2026-09-03',
      address: '5800 SCENIC DR', city: 'Yakima', description: 'New common wall single family residence.', valuation: null
    });
    expect(yakimaPermit(ROW).contacts).toMatchObject([{ role: 'Applicant', company: 'MODERN STRUCTURES LLC', name: 'RICHARD LILIENTHAL' }]);
  });
  it('reads the applicant column as a company, a person or both', () => {
    expect(applicantContacts('SCENIC TOWNHOUSES LLC')).toMatchObject([{ company: 'SCENIC TOWNHOUSES LLC', name: '' }]);
    expect(applicantContacts('HOCHREIN RICHARD')).toMatchObject([{ company: '', name: 'HOCHREIN RICHARD' }]);
    expect(applicantContacts('CARDENAS, SAMUEL')).toMatchObject([{ name: 'SAMUEL CARDENAS' }]);
    expect(applicantContacts('')).toEqual([]);
  });
  it('reads the report’s rows by column title, once each, and stops on a bad one', () => {
    const rec = { 'Permit Number': 'B1', 'Site Address': 'A', Applicant: 'X', 'Date Issued': '09/03/2026', 'Permit Type': 'Residential-Duplex', 'Project Description': 'd' };
    expect(yakimaRows([rec, rec, { ...rec, 'Permit Number': 'B2' }]).map((r) => r.number)).toEqual(['B1', 'B2']);
    expect(() => yakimaRows([{ 'Permit Number': 'B1' }])).toThrow(/no .* column/);
    expect(() => yakimaRows([{ ...rec, 'Date Issued': 'soon' }])).toThrow(/stopped so nothing is missed/);
    expect(reportDay('02/30/2026')).toBe('');
  });
});

const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
const HEAD = '"Issued Permits for New Buildings","","","","",""\n"09/01/2026 through 11/02/2026","","","","",""\n"Permit Number","Site Address","Applicant","Date Issued","Permit Type","Project Description"\n';

function server(csv: string) {
  const starts: string[] = [];
  const fetchImpl = async (url: string, init: Loose = {}) => {
    const u = new URL(url);
    if (u.hostname === 'ci-yakima-wa.smartgovcommunity.com' && u.pathname === '/Public/ReportsView') return new Response('<input name="__VIEWSTATE" value="VS" />', { status: 200 });
    if (u.pathname === '/Public/ReportsView/ViewReport') return new Response('', { status: 302, headers: { location: 'https://reports-new.smartgovcommunity.com/exago/ExagoHome.aspx?sn=0' } });
    if (u.pathname === '/exago/ExagoHome.aspx') {
      const cfg = JSON.stringify({ TempPath: 'TMP==', ApiAction: 'ExecuteReport', ApiReportId: 'SID', Language: 'en-us' }).replace(/"/g, '&quot;');
      return new Response(`<input type="hidden" value="${cfg}" />`, { status: 200 });
    }
    if (u.pathname.startsWith('/exago/wrajax/')) {
      const method = u.pathname.replace('/exago/wrajax/', '').replace('.ashx', '');
      const args = JSON.parse(init.body).args;
      if (method === 'Client.BaseExecuteCtrl.LoadCallback') return json({ value: { Data: { ReportData: 'STATE' } } });
      if (method === 'Callbacks.Execute.StartExecute') { starts.push(args.map((a: Loose) => a.value).filter((v: unknown) => typeof v === 'string').join(' ')); return json({ value: { ExecutionId: 'EID' } }); }
      if (method === 'Callbacks.Execute.GetStatus') return json({ value: { phase: 4, percent: 100 } });
      return json({ value: null });
    }
    if (u.pathname === '/exago/ExecuteExport.aspx') return new Response(csv, { status: 200, headers: { 'content-type': 'application/csv' } });
    return new Response('no', { status: 404 });
  };
  return { fetchImpl, starts };
}
const make = (s: { fetchImpl: Loose }) => createYakimaSource({ fetchImpl: s.fetchImpl as never, sleep: async () => {}, now: () => new Date('2026-11-02T18:00:00Z'), pollMs: 0 });

describe('Yakima reader', () => {
  it('runs the report for the window to tomorrow and reads its rows', async () => {
    const s = server(`${HEAD}"B260587","5806 Scenic Dr","SCENIC TOWNHOUSES LLC","09/03/2026","Residential-Single-Family-New","New SFR"\n"B260836","808 S 9TH ST #1-2","PRADO LUCY","09/10/2026","Residential-Duplex","Conversion, ""quoted"""\n`);
    const { rows, total } = await make(s).issuedSince('2026-09-01');
    expect(rows.map((r: Loose) => [r.number, r.issuedOn, r.type])).toEqual([['B260587', '2026-09-03', 'Residential-Single-Family-New'], ['B260836', '2026-09-10', 'Residential-Duplex']]);
    expect(rows[1].description).toBe('Conversion, "quoted"');
    expect(total).toBe(2);
    expect(s.starts[0]).toContain(dateFilter('2026-09-01', '2026-11-03'));
  });
  it('treats a report with no table as an empty window', async () => {
    const { rows } = await make(server('"Issued Permits for New Buildings","","","","",""\n')).issuedSince('2026-10-30');
    expect(rows).toEqual([]);
  });
  it('stops on a different report, a permit outside the window, or a missing column', async () => {
    await expect(make(server('"Something else"\n')).issuedSince('2026-10-30')).rejects.toThrow(/not the new-buildings report/);
    await expect(make(server(`${HEAD}"B1","A","X","08/01/2026","Residential-Duplex","d"\n`)).issuedSince('2026-09-01')).rejects.toThrow(/outside/);
    await expect(make(server('"Permit Number","Site Address"\n"B1","A"\n')).issuedSince('2026-09-01')).rejects.toThrow(/no .* column/);
  });
  it('has a reader registered', () => {
    expect(typeof (createPermitReaders() as Loose).yakima.issuedSince).toBe('function');
  });
});
