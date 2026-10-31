import type { Loose } from '../types/records.ts';
import { describe, it, expect } from 'vitest';
import { categoryFor, isUnsortedBuildingType, RULES, SOURCES, sourcesInCounties } from './permitRules.ts';
import { anacortesRows, anacortesPermit, splitTypeAndAddress, applicantName, reportDay } from './rules/anacortes.ts';
import { createAnacortesSource, dateFilter } from './sources/anacortes.ts';
import { createPermitReaders } from './readers.ts';
import { parseCsv } from './sources/shoreline.ts';

const cat = (t: unknown) => categoryFor('anacortes', t);

describe('Anacortes types', () => {
  it('files the city’s exact building types', () => {
    expect(cat('RESIDENTIAL SINGLE FAMILY BUILDING')).toBe('new_home');
    expect(cat('RESIDENTIAL SINGLE FAMILY  BUILDING')).toBe('new_home');
    expect(cat('COTTAGE UNIT')).toBe('adu');
    expect(cat('ACCESSORY DWELLING UNIT/ADU')).toBe('adu');
    expect(cat('RESIDENTIAL REMODEL WITH NEW SQ FOOTAGE')).toBe('addition');
    expect(cat('RESIDENTIAL  REMODEL WITH NO NEW SQ FOOTAGE')).toBe('remodel');
    expect(cat('COMMERCIAL TENANT IMPROVEMENT')).toBe('commercial_remodel');
    expect(cat('COMMERCIAL')).toBe('building_other');
  });

  it('skips trades, roofs, outbuildings, signs, right-of-way and land-use work without reporting them', () => {
    for (const t of ['MECHANICAL AND GAS WATER HEATERS, RESIDENTIAL', 'RE-ROOF RESIDENTIAL', 'RE-ROOF COMMERCIAL', 'WINDOWS/DOORS/SIDING NEW OR REPLACED', 'FENCE', 'DECK OR PORCH',
      'SOLAR PERMIT', 'SIGN PERMIT', 'ACCESSORY STRUCTURE/GARAGE/RETAINING WALL', 'DECONSTRUCTION & DEMOLITION', 'FOUNDATION ONLY', 'RIGHT-OF-WAY PERMIT APPLICATION',
      'SHORELINE EXEMPTION PERMIT (TYPE 1)', 'CLEAR AND GRADE', 'SITE DEVELOPMENT (TYPE 1)', 'BOUNDARY LINE ADJUSTMENT (TYPE 1)', 'CONDITIONAL USE PERMIT (TYPE 2)']) {
      expect(cat(t), t).toBeNull();
      expect(isUnsortedBuildingType('anacortes', t), t).toBe(false);
    }
  });

  it('reports a building type nobody has sorted', () => {
    expect(isUnsortedBuildingType('anacortes', 'RESIDENTIAL DUPLEX')).toBe(true);
    expect(isUnsortedBuildingType('anacortes', 'MULTI-FAMILY BUILDING')).toBe(true);
    expect(isUnsortedBuildingType('anacortes', 'TOWNHOUSE')).toBe(true);
  });

  it('is under the Skagit filter beside the county, a city office', () => {
    expect(SOURCES.anacortes).toMatchObject({ county: 'skagit', kind: 'city', readsDetails: false, phones: false });
    expect(sourcesInCounties(['skagit'])).toEqual(['skagit_county', 'anacortes']);
    expect(Object.keys(createPermitReaders())).toContain('anacortes');
  });
});

describe('Anacortes rows', () => {
  it('splits a type from its address, with or without a known type', () => {
    expect(splitTypeAndAddress('RE-ROOF RESIDENTIAL 1403 PORTALIS COURT')).toEqual({ type: 'RE-ROOF RESIDENTIAL', address: '1403 PORTALIS COURT' });
    expect(splitTypeAndAddress('RESIDENTIAL  REMODEL WITH NO NEW SQ FOOTAGE 1113 4TH STREET')).toEqual({ type: 'RESIDENTIAL REMODEL WITH NO NEW SQ FOOTAGE', address: '1113 4TH STREET' });
    expect(splitTypeAndAddress('SHORELINE EXEMPTION PERMIT (TYPE 1) 500 I Ave')).toEqual({ type: 'SHORELINE EXEMPTION PERMIT (TYPE 1)', address: '500 I Ave' });
    expect(splitTypeAndAddress('SOMETHING NEW (TYPE 2) 12 MAIN ST')).toEqual({ type: 'SOMETHING NEW (TYPE 2)', address: '12 MAIN ST' });
    expect(splitTypeAndAddress('PRE-APPLICATION MEETING REQUEST NO SITUS ADDRESS').address).toBe('');
    expect(splitTypeAndAddress('MECHANICAL AND GAS WATER HEATERS, RESIDENTIAL ')).toEqual({ type: 'MECHANICAL AND GAS WATER HEATERS, RESIDENTIAL', address: '' });
  });

  it('reads the applicant’s name, flipping "Last, First", and keeps the rest as the description', () => {
    expect(applicantName('Applicant:  Birkeland, Kenneth 4314 Whistle Lake Road Birkeland Shop')).toEqual({ name: 'Kenneth Birkeland', company: '', rest: '4314 Whistle Lake Road Birkeland Shop' });
    expect(applicantName('Applicant:  SignDog 2900 T. Ave Suite A Marina Entry Signs')).toMatchObject({ name: '', company: 'SignDog' });
  });

  it('reads only real dates', () => {
    expect(reportDay('10/21/2026')).toBe('2026-10-21');
    expect(reportDay('02/30/2026')).toBe('');
    expect(reportDay('2026-10-21')).toBe('');
  });

  const HEAD = ['Issued Date', 'Application Number', '', '', 'Application Type / Site Address', '', '', 'Parcel', 'Applicant / Project Name', '', '', 'Struct / Units', 'Primary Contractor', '', '', 'Valuation'];
  const row = (date: unknown, n: unknown, type: string, contractor = '', value = '') => [date, n, '', '', type, '', '', 'P1', 'Applicant:  Gilbert, Steven 1 Main St Remodel', '', '', '1/0', contractor, '', '', value];
  const csv = (rows: Loose[], head = HEAD) => [head, ...rows].map((r) => r.map((c: string) => `"${c}"`).join(',')).join('\n');

  it('copies a permit exactly, with the value and the contractor', () => {
    const rows = anacortesRows(parseCsv(csv([row('10/21/2026', 'BLD-2026-0155', 'RESIDENTIAL SINGLE FAMILY  BUILDING 15903 YOKEKO DRIVE', 'KREIDER CONSTRUCTION INC', '1,398,000.50')])));
    const p = anacortesPermit(rows[0]);
    expect(p).toMatchObject({ source: 'anacortes', permitNumber: 'BLD-2026-0155', category: 'new_home', issuedOn: '2026-10-21', address: '15903 YOKEKO DRIVE', city: 'Anacortes', status: 'Issued', valuation: 1398000.5, parcel: 'P1' });
    expect(p.contacts.map((c: string) => [c.kind, c.company || c.name])).toEqual([['contractor', 'KREIDER CONSTRUCTION INC'], ['applicant', 'Steven Gilbert']]);
  });

  it('leaves out the title, blank and total lines, and a permit shown twice', () => {
    const rows = anacortesRows(parseCsv(csv([row('10/21/2026', 'A-1', 'FENCE 1 MAIN ST'), row('10/21/2026', 'A-1', 'FENCE 1 MAIN ST'), ['', '', '', '', '', '', '', '', '', '', '', '', '$19,507,537.04', '', '', '']])));
    expect(rows.map((r) => r.number)).toEqual(['A-1']);
  });

  it('stops on a changed layout or a dated row it cannot read', () => {
    expect(() => anacortesRows(parseCsv(csv([row('10/21/2026', 'A-1', 'FENCE 1 MAIN ST')], HEAD.map((h) => (h === 'Valuation' ? 'Value' : h)))))).toThrow(/no Valuation column/);
    expect(() => anacortesRows(parseCsv(csv([row('13/45/2026', 'A-1', 'FENCE 1 MAIN ST')])))).toThrow(/stopped so nothing is missed/);
    expect(() => anacortesRows(parseCsv(csv([row('10/21/2026', '', 'FENCE 1 MAIN ST')])))).toThrow(/stopped so nothing is missed/);
  });
});

describe('Anacortes reader', () => {
  const json = (o: unknown, init: Loose = {}) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
  const CSV_HEAD = '"","",""\n"Issued Permits with Valuation"\n"Issued Date","Application Number","","","Application Type / Site Address","","","Parcel","Applicant / Project Name","","","Struct / Units","Primary Contractor","","","Valuation"\n';

  /** The portal and report server as far as the reader uses them. */
  function server({ csv, status = [{ phase: 3, percent: 50 }, { phase: 4, percent: 100 }], refuse = null, exportType = 'application/csv' }: Loose = {}) {
    const calls: unknown[][] = [];
    const fetchImpl = async (url: string, init: Loose = {}) => {
      const u = new URL(url);
      calls.push([init.method || 'GET', u.pathname + (u.search.startsWith('?reportId') ? '?reportId' : ''), init.headers?.Cookie || '']);
      if (u.pathname === '/Public/ReportsView') {
        return new Response('<input name="__VIEWSTATE" id="__VIEWSTATE" value="VS" /><input name="__VIEWSTATEGENERATOR" value="GEN" />', { status: 200, headers: { 'set-cookie': 'ASP.NET_SessionId=portal; path=/' } });
      }
      if (u.pathname === '/Public/ReportsView/ViewReport') return new Response('', { status: 302, headers: { location: 'https://reports-new.smartgovcommunity.com/exago/ExagoHome.aspx?d=x', 'set-cookie': 'ASP.NET_SessionId=exago; path=/' } });
      if (u.pathname === '/exago/ExagoHome.aspx' && u.searchParams.has('d')) return new Response('', { status: 302, headers: { location: '/exago/ExagoHome.aspx?sn=0' } });
      if (u.pathname === '/exago/ExagoHome.aspx') {
        const cfg = JSON.stringify({ TempPath: 'TMP==', ApiAction: 'ExecuteReport', ApiReportId: 'SESSION-ID', Language: 'en-us' }).replace(/"/g, '&quot;');
        return new Response(`<input type="hidden" value="${cfg}" />`, { status: 200 });
      }
      if (u.pathname.startsWith('/exago/wrajax/')) {
        const method = u.pathname.replace('/exago/wrajax/', '').replace('.ashx', '');
        const args = JSON.parse(init.body).args;
        calls.push([method, args.map((a: Loose) => a.value).filter((v: Loose) => typeof v === 'string' && v.length < 120)]);
        if (refuse === method) return json({ value: 'Error', isError: true, messageText: 'boom' });
        if (method === 'Client.BaseExecuteCtrl.LoadCallback') return json({ value: { Data: { ReportData: 'STATE' } } });
        if (method === 'Callbacks.Execute.StartExecute') return json({ value: { ExecutionId: 'EID' } });
        if (method === 'Callbacks.Execute.GetStatus') return json({ value: status.shift() || status.at(-1) || { phase: 4, percent: 100 } });
        return json({ value: null });
      }
      if (u.pathname === '/exago/ExecuteExport.aspx') return new Response(csv, { status: 200, headers: { 'content-type': exportType } });
      return new Response('no', { status: 404 });
    };
    return { fetchImpl, calls };
  }
  const make = (s: Loose, now = '2026-10-22T18:00:00Z') => createAnacortesSource({ fetchImpl: s.fetchImpl, sleep: async () => {}, now: () => new Date(now), pollMs: 0 });

  it('runs the report the way the page does, asking from the window’s start to tomorrow, and reads its rows', async () => {
    const s = server({ csv: `${CSV_HEAD}"10/21/2026","BLD-1","","","FENCE 1 MAIN ST","","","P1","Applicant:  A, B 1 X","","","1/0","","","","500.00"\n"10/22/2026","BLD-2","","","COTTAGE UNIT 2 MAIN ST","","","P2","Applicant:  C, D 2 X","","","1/0","ACME","","","80,000.00"\n"","","","","","","","","","","","","$80,500.00","","",""\n` });
    const { rows, total } = await make(s).issuedSince('2026-10-01');
    expect(rows.map((r) => [r.number, r.issuedOn, r.type])).toEqual([['BLD-1', '2026-10-21', 'FENCE'], ['BLD-2', '2026-10-22', 'COTTAGE UNIT']]);
    expect(total).toBe(2);
    const names = s.calls.filter((c: string) => c[0].includes('.') && !c[0].startsWith('/')).map((c: string) => c[0]);
    expect(names).toEqual(['Client.BaseExecuteCtrl.LoadCallback', 'Callbacks.Execute.StartExecute', 'Callbacks.Execute.GetStatus', 'Callbacks.Execute.GetStatus', 'Callbacks.Execute.TransmitExecution']);
    const start = s.calls.find((c: string) => c[0] === 'Callbacks.Execute.StartExecute')[1];
    expect(start).toContain(dateFilter('2026-10-01', '2026-10-23'));
    expect(start).toContain('STATE');
    // The report server's session cookie is sent back to it, not the portal's.
    expect(s.calls.find((c: string) => c[0] === 'POST' && c[1] === '/Public/ReportsView/ViewReport?reportId')[2]).toContain('portal');
    expect(s.calls.find((c: string) => c[1] === '/exago/ExecuteExport.aspx')[2]).toContain('exago');
  });

  it('treats a report with no rows as an empty window', async () => {
    const { rows } = await make(server({ csv: '"","",""\n"Issued Permits with Valuation"\n"No data"\n' })).issuedSince('2026-10-22');
    expect(rows).toEqual([]);
  });

  it('stops on a row outside the window it asked for', async () => {
    const row = (d: unknown) => `"${d}","BLD-1","","","FENCE 1 MAIN ST","","","P1","Applicant:  A, B 1 X","","","1/0","","","","500.00"\n`;
    await expect(make(server({ csv: CSV_HEAD + row('09/30/2026') })).issuedSince('2026-10-01')).rejects.toThrow(/outside 2026-10-01 to 2026-10-22/);
    await expect(make(server({ csv: CSV_HEAD + row('10/24/2026') })).issuedSince('2026-10-01')).rejects.toThrow(/stopped so nothing is missed/);
  });

  it('stops when the report server refuses, the report fails, or the download is not a CSV', async () => {
    await expect(make(server({ csv: '', refuse: 'Callbacks.Execute.StartExecute' })).issuedSince('2026-10-01')).rejects.toThrow(/refused Callbacks.Execute.StartExecute: boom/);
    await expect(make(server({ csv: '', status: [{ phase: 3, percent: 10, msg: 'Query failed' }] })).issuedSince('2026-10-01')).rejects.toThrow(/report failed: Query failed/);
    await expect(make(server({ csv: '<html>', exportType: 'text/html' })).issuedSince('2026-10-01')).rejects.toThrow(/not a CSV/);
    await expect(make(server({ csv: 'something else entirely' })).issuedSince('2026-10-01')).rejects.toThrow(/has changed — it is not the issued-permits report/);
  });
});

describe('the Anacortes source in the sources contract', () => {
  it('has the rules the pull relies on', () => {
    expect(RULES.anacortes.emptyError('2026-10-01')).toMatch(/no permits issued since 2026-10-01/);
  });
});
