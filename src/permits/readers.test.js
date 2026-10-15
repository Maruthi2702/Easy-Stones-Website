// The King County readers (2026-10-14) against fake servers: MyBuildingPermit
// (split windows, refused searches, a date filter that isn't honoured),
// Seattle's open data (counts that don't add up, the permit page's license),
// Shoreline's eTRAKiT export (a full page, a wrong day), Bellevue (two
// sources joined), the county's parcels and its monthly spreadsheet.
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { createMbpClient, createMbpSource } from './sources/mbp.js';
import { createSeattleSource, seattleWhere } from './sources/seattle.js';
import { createShorelineSource, parseCsv, hiddenFields } from './sources/shoreline.js';
import { createBellevueSource } from './sources/bellevue.js';
import { createKingParcels } from './sources/kingParcels.js';
import { createKingReports } from './kingCountyReport.js';
import { createRentonSource } from './sources/energov.js';

const noSleep = async () => {};
const res = (body, { status = 200, type = 'application/json', cookies = [] } = {}) => ({
  ok: status < 400,
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  arrayBuffer: async () => body,
  headers: { get: (h) => (h.toLowerCase() === 'content-type' ? type : null), getSetCookie: () => cookies }
});
const msDay = (day) => `/Date(${Date.parse(`${day}T07:00:00Z`)})/`;
const mbpRow = (n, day, type = 'Residential - New') => ({ PermitNumber: n, PermitType: type, IssuedDate: msDay(day), Address: '1 MAIN ST' });

/** A fake MyBuildingPermit: `permits` by day; searches over `cap` rows are refused. */
function fakeMbp(permits, { cap = 5, statuses = ['Issued', 'Finaled'] } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname === '/') return res('<input name="__RequestVerificationToken" type="hidden" value="tok123" />', { type: 'text/html', cookies: ['sess=abc; path=/'] });
    if (u.pathname.endsWith('GetPermitStatuses')) return res(statuses.map((s) => ({ Value: s })));
    if (u.pathname.endsWith('GetSearchResults')) {
      const body = new URLSearchParams(init.body);
      const [fm, fd, fy] = body.get('FromDate').split('/');
      const [tm, td, ty] = body.get('ToDate').split('/');
      const from = `${fy}-${fm}-${fd}`;
      const to = `${ty}-${tm}-${td}`;
      const sts = body.getAll('SelectedPermitStatuses');
      calls.push({ from, to, sts, token: body.get('__RequestVerificationToken'), cookie: init.headers.Cookie });
      const rows = permits.filter((p) => p.day >= from && p.day <= to && sts.includes(p.status || 'Issued')).map((p) => p.row);
      if (rows.length > cap) return res({ success: false, data: '', ErrorMessage: 'Search returned too many results. Please refine your search criteria.' });
      return res(rows);
    }
    if (u.pathname.includes('/PeopleData/')) return res([{ Name: 'ABC HOMES', ContractorLicNum: 'ABCHOHL123AB', Type: 'Contractor' }]);
    if (u.pathname.startsWith('/PermitDetails/')) return res('<th>Parcel:</th><td>2624089001</td><th>Project Name:</th><td>NEW HOUSE</td>', { type: 'text/html' });
    return res({}, { status: 404 });
  };
  return { fetchImpl, calls };
}

describe('MyBuildingPermit reader', () => {
  const permits = (days) => days.map((day, i) => ({ day, row: mbpRow(`P${i}`, day) }));

  it('reads a week at a time with the session’s cookie and token, every status named', async () => {
    const mbp = fakeMbp(permits(['2026-10-01', '2026-10-03', '2026-10-09']));
    const client = createMbpClient({ fetchImpl: mbp.fetchImpl, sleep: noSleep });
    const src = createMbpSource({ client, jurisId: 11, office: 'BURIEN', label: 'Burien', today: () => '2026-10-10' });
    const r = await src.issuedSince('2026-10-01');
    expect(r.rows.map((x) => x.PermitNumber).sort()).toEqual(['P0', 'P1', 'P2']);
    // Each search asks a day further (its "to" means midnight) and keeps only its own days.
    expect(mbp.calls.map((c) => [c.from, c.to])).toEqual([['2026-10-01', '2026-10-08'], ['2026-10-08', '2026-10-11']]);
    expect(mbp.calls[0]).toMatchObject({ token: 'tok123', cookie: 'sess=abc', sts: ['Issued', 'Finaled'] });
  });

  it('halves a refused window down to single days, then splits the statuses', async () => {
    const busy = [...Array(4)].map((_, i) => ({ day: '2026-10-02', row: mbpRow(`I${i}`, '2026-10-02') }))
      .concat([...Array(3)].map((_, i) => ({ day: '2026-10-02', status: 'Finaled', row: mbpRow(`F${i}`, '2026-10-02') })))
      .concat(permits(['2026-10-05']));
    const mbp = fakeMbp(busy, { cap: 5 });
    const src = createMbpSource({ client: createMbpClient({ fetchImpl: mbp.fetchImpl, sleep: noSleep }), jurisId: 1, office: 'BELLEVUE', label: 'Bellevue', today: () => '2026-10-07' });
    const r = await src.issuedSince('2026-10-01');
    expect(r.rows).toHaveLength(8);
    // Oct 2 alone (asked as Oct 2–3), one status at a time.
    expect(mbp.calls.some((c) => c.from === '2026-10-02' && c.to === '2026-10-03' && c.sts.length === 1)).toBe(true);
  });

  it('keeps a permit issued late on a window’s last day, and leaves the next day’s to the next window', async () => {
    const late = (n, day, time) => ({ PermitNumber: n, PermitType: 'BSF', Address: '1', IssuedDate: `/Date(${Date.parse(`${day}T${time}-07:00`)})/` });
    const mbp = fakeMbp([]);
    const answered = [late('LATE', '2026-10-07', '16:30:00'), late('NEXT', '2026-10-08', '00:00:00')];
    const fetchImpl = async (url, init) => (url.endsWith('GetSearchResults') ? res(answered) : mbp.fetchImpl(url, init));
    const src = createMbpSource({ client: createMbpClient({ fetchImpl, sleep: noSleep }), jurisId: 5, office: 'KIRKLAND', label: 'Kirkland', today: () => '2026-10-07' });
    const r = await src.issuedSince('2026-10-01');
    expect(r.rows.map((x) => x.PermitNumber)).toEqual(['LATE']);
  });

  it('stops when a row falls outside the days asked for — a date filter quietly ignored', async () => {
    const mbp = fakeMbp([]);
    const fetchImpl = async (url, init) => (url.endsWith('GetSearchResults') ? res([mbpRow('X', '2026-08-01')]) : mbp.fetchImpl(url, init));
    const src = createMbpSource({ client: createMbpClient({ fetchImpl, sleep: noSleep }), jurisId: 20, office: 'KING COUNTY', label: 'King County', today: () => '2026-10-03' });
    await expect(src.issuedSince('2026-10-01')).rejects.toThrow(/date filter isn’t working/);
  });

  it('gives up on a day it can’t list even one status at a time', async () => {
    const crowd = [...Array(7)].map((_, i) => ({ day: '2026-10-02', row: mbpRow(`I${i}`, '2026-10-02') }));
    const mbp = fakeMbp(crowd, { cap: 5, statuses: ['Issued'] });
    const src = createMbpSource({ client: createMbpClient({ fetchImpl: mbp.fetchImpl, sleep: noSleep }), jurisId: 1, office: 'BELLEVUE', label: 'Bellevue', today: () => '2026-10-02' });
    await expect(src.issuedSince('2026-10-02')).rejects.toThrow(/too many Bellevue permits on 2026-10-02/);
  });

  it('reads a lead’s people, parcel and — for the county — the parcel’s city', async () => {
    const mbp = fakeMbp([]);
    const places = { lookup: async (pins) => new Map(pins.map((p) => [p, { city: 'Snoqualmie', zip: '98065' }])) };
    const src = createMbpSource({ client: createMbpClient({ fetchImpl: mbp.fetchImpl, sleep: noSleep }), jurisId: 20, office: 'KING COUNTY', label: 'King County', places });
    expect(await src.details('ADDC25-0739')).toEqual({
      people: [{ Name: 'ABC HOMES', ContractorLicNum: 'ABCHOHL123AB', Type: 'Contractor' }],
      parcel: '2624089001', projectName: 'NEW HOUSE', place: { city: 'Snoqualmie', zip: '98065' }
    });
  });

  it('fails clearly when the search page has no form token', async () => {
    const fetchImpl = async () => res('<html>maintenance</html>', { type: 'text/html' });
    const client = createMbpClient({ fetchImpl, sleep: noSleep });
    await expect(client.search(1, '2026-10-01', '2026-10-01', ['Issued'])).rejects.toThrow(/no form token/);
  });
});

describe('Seattle reader', () => {
  const row = (i) => ({ ':id': `row-${i}`, permitnum: `${7000000 + i}-CN`, permitclass: 'Single Family/Duplex', permittypedesc: 'New', issueddate: '2026-10-05T00:00:00.000' });

  function fakeSocrata(rows, { count = rows.length } = {}) {
    const calls = [];
    const fetchImpl = async (url) => {
      const q = new URL(url).searchParams;
      calls.push(Object.fromEntries(q));
      if (q.get('$select') === 'count(*) AS n') return res([{ n: String(count) }]);
      const offset = Number(q.get('$offset'));
      return res(rows.slice(offset, offset + Number(q.get('$limit'))));
    };
    return { fetchImpl, calls };
  }

  it('asks for building permits issued since the start, counted, in row order', async () => {
    const s = fakeSocrata([row(1), row(2)]);
    const r = await createSeattleSource({ fetchImpl: s.fetchImpl, sleep: noSleep }).issuedSince('2026-09-14');
    expect(r.rows).toHaveLength(2);
    expect(s.calls[1]).toMatchObject({ $where: "issueddate >= '2026-09-14' AND permittypemapped = 'Building'", $order: ':id', $offset: '0' });
    expect(() => seattleWhere('yesterday')).toThrow(/Not a date/);
  });

  it('fails when the rows don’t add up to the count', async () => {
    const s = fakeSocrata([row(1)], { count: 2 });
    await expect(createSeattleSource({ fetchImpl: s.fetchImpl, sleep: noSleep }).issuedSince('2026-09-14')).rejects.toThrow(/said 2 permits but sent 1/);
  });

  it('rechecks the month in permit-number order', async () => {
    const s = fakeSocrata([row(1)]);
    const out = await createSeattleSource({ fetchImpl: s.fetchImpl, sleep: noSleep }).recheck('2026-10-01');
    expect(out).toEqual([{ number: '7000001-CN', type: 'Single Family/Duplex', subtype: 'New', issuedOn: '2026-10-05' }]);
    expect(s.calls[1].$order).toBe('permitnum');
  });

  it('reads the contractor’s license from the permit’s page, and refuses a page that isn’t the permit', async () => {
    const page = '<h1>Record 7116062-CN</h1><span>Contractor License: </span></div><div><span>VIVIDDL801B4</span>';
    const fetchImpl = async (url) => (url.includes('7116062-CN') ? res(page, { type: 'text/html' }) : res('<html>Sign in</html>', { type: 'text/html' }));
    const src = createSeattleSource({ fetchImpl, sleep: noSleep });
    expect(await src.details('7116062-CN')).toEqual({ license: 'VIVIDDL801B4' });
    await expect(src.details('7000001-CN')).rejects.toThrow(/didn’t show the permit/);
  });
});

describe('Shoreline reader', () => {
  const PAGE = '<form><input type="hidden" name="__VIEWSTATE" value="abc&amp;def" /><input type="hidden" name="__EVENTVALIDATION" value="x" /><input name="ctl00$cplMain$btnExportToExcel" /></form>';
  const RESULTS = (n) => `${PAGE}<table>${'<tr class="rgRow"><td>x</td></tr>'.repeat(n)}</table>`;
  const csv = (rows) => ['"PERMIT NUMBER","APPLIED DATE","ISSUED DATE","Permit Type","PARCEL","ADDRESS","OWNER NAME","APPLICANT NAME","CONTRACTOR NAME","RECORDID"', ...rows].join('\r\n');

  function fakeEtrakit(byDay) {
    const posts = [];
    const fetchImpl = async (url, init = {}) => {
      if (init.method !== 'POST') return res(PAGE, { type: 'text/html', cookies: ['ASP.NET_SessionId=s1; path=/'] });
      const body = new URLSearchParams(init.body);
      posts.push({ body: Object.fromEntries(body), cookie: init.headers.Cookie });
      if (body.get('ctl00$cplMain$btnSearch')) return res(RESULTS(Math.min(10, (byDay[body.get('ctl00$cplMain$txtSearchString')] || []).length)), { type: 'text/html' });
      return res(`\uFEFF${csv(byDay[body.get('ctl00$cplMain$txtSearchString')] || [])}`, { type: 'text/csv; charset=utf-8;' });
    };
    return { fetchImpl, posts };
  }

  it('reads each day’s export, posting the page’s own fields back', async () => {
    const e = fakeEtrakit({ '10/13/2026': ['"COM26-0989","04/28/2026","10/13/2026","COMMERCIAL","616","17537 15TH AVE NE","COTTON","VALLE","ELKO, INC","MS:1"'] });
    const r = await createShorelineSource({ fetchImpl: e.fetchImpl, sleep: noSleep, today: () => '2026-10-14' }).issuedSince('2026-10-13');
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ 'PERMIT NUMBER': 'COM26-0989', 'CONTRACTOR NAME': 'ELKO, INC' });
    expect(r.pages).toBe(2);
    expect(e.posts[0].body).toMatchObject({ __VIEWSTATE: 'abc&def', 'ctl00$cplMain$ddSearchBy': 'Permit_Main.ISSUED', 'ctl00$cplMain$ddSearchOper': 'EQUALS', 'ctl00$cplMain$txtSearchString': '10/13/2026' });
    expect(e.posts[0].cookie).toBe('ASP.NET_SessionId=s1');
  });

  it('treats a search with no result rows as an empty day, never exporting the last search again', async () => {
    const e = fakeEtrakit({ '10/12/2026': ['"X1","10/01/2026","10/12/2026","COMMERCIAL","","","","","","R1"'] });
    const r = await createShorelineSource({ fetchImpl: e.fetchImpl, sleep: noSleep, today: () => '2026-10-13' }).issuedSince('2026-10-12');
    expect(r.rows.map((x) => x['PERMIT NUMBER'])).toEqual(['X1']);
    expect(e.posts.filter((p) => p.body['ctl00$cplMain$btnExportToExcel'])).toHaveLength(1);
    // Each day in a session of its own.
    expect(e.posts.every((p) => p.cookie === 'ASP.NET_SessionId=s1')).toBe(true);
  });

  it('stops rather than save a day short when the export is full', async () => {
    const full = [...Array(100)].map((_, i) => `"X${i}","10/01/2026","10/13/2026","COMMERCIAL","","","","","","R${i}"`);
    const e = fakeEtrakit({ '10/13/2026': full });
    await expect(createShorelineSource({ fetchImpl: e.fetchImpl, sleep: noSleep, today: () => '2026-10-13' }).issuedSince('2026-10-13')).rejects.toThrow(/more than its export holds/);
  });

  it('stops when the export answers a different day', async () => {
    const e = fakeEtrakit({ '10/13/2026': ['"X1","10/01/2026","10/12/2026","COMMERCIAL","","","","","","R1"'] });
    await expect(createShorelineSource({ fetchImpl: e.fetchImpl, sleep: noSleep, today: () => '2026-10-13' }).issuedSince('2026-10-13')).rejects.toThrow(/answered a permit issued 10\/12\/2026/);
  });

  it('reads CSV with quotes, commas and a byte-order mark, and WebForms hidden fields', () => {
    expect(parseCsv('\uFEFF"A","B"\r\n"1, two","say ""hi"""\r\n')).toEqual([{ A: '1, two', B: 'say "hi"' }]);
    expect(parseCsv('')).toEqual([]);
    expect(hiddenFields('<input type="hidden" name="a" value="1&amp;2" /><input name="b" />')).toEqual({ a: '1&2' });
  });
});

describe('Bellevue, the parcels, the county’s spreadsheet and Renton', () => {
  it('joins MyBuildingPermit’s permit with the city’s own record', async () => {
    const mbp = { issuedSince: async () => ({ rows: [], pages: 1, total: 0 }), details: async () => ({ people: [], parcel: '1', projectName: '' }) };
    const src = createBellevueSource({ mbp, layer: { byNumber: async (n) => ({ PERMITNUMBER: n, VALUATION: 5 }) } });
    expect(await src.details('26 1 BS')).toEqual({ people: [], parcel: '1', projectName: '', record: { PERMITNUMBER: '26 1 BS', VALUATION: 5 } });
    const down = createBellevueSource({ mbp, layer: { byNumber: async () => { throw new Error('down'); } } });
    expect((await down.details('26 1 BS')).record).toBeNull();
  });

  it('finds a parcel’s postal city and ZIP', async () => {
    let where = '';
    const fetchImpl = async (url) => {
      where = new URL(url).searchParams.get('where');
      return res({ features: [{ attributes: { PIN: '2624089001', POSTALCTYNAME: 'NORTH BEND', ZIP5: '98045' } }] });
    };
    const out = await createKingParcels({ fetchImpl, sleep: noSleep }).lookup(['2624089001', 'not-a-pin']);
    expect(where).toBe("PIN IN ('2624089001')");
    expect(out.get('2624089001')).toEqual({ city: 'North Bend', zip: '98045' });
  });

  it('reads the county’s spreadsheet', async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['King County Issued Permits Report'], [], [], [],
      ['PERMIT NBR', 'PERMIT TYPE', 'ISSUED DATE', 'JOB VALUE', 'PRIMARY ADDRESS'],
      ['SFR26-0001', 'Building/Residential Building/Dwelling-Single/NA', new Date('2026-09-20T12:00:00Z'), 650000, '1 MAIN ST, KENT, WA 98030']
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const fetchImpl = async (url) => (url.endsWith('.xlsx')
      ? res(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), { type: 'application/vnd.openxmlformats' })
      : res('<a href="/r/king-county-issued-permits-2026-09.xlsx">Sep</a>', { type: 'text/html' }));
    const reports = createKingReports({ fetchImpl, page: 'https://kingcounty.gov/reports' });
    const [sep] = await reports.list();
    expect(sep).toMatchObject({ month: '2026-09', url: 'https://kingcounty.gov/r/king-county-issued-permits-2026-09.xlsx' });
    expect(await reports.rows(sep.url)).toEqual([
      {
        number: 'SFR26-0001', type: 'Building/Residential Building/Dwelling-Single/NA', project: '', description: '', status: '', appliedOn: null, applicant: '', owner: '',
        address: '1 MAIN ST, KENT, WA 98030', issuedOn: '2026-09-20', valuation: 650000, parcel: '', city: 'Kent', zip: '98030', units: null
      }
    ]);
  });

  it('reads Renton through the same EnerGov reader as Whatcom, under Renton’s tenant', async () => {
    const seen = [];
    const fetchImpl = async (url, init) => {
      seen.push({ url, tenant: init.headers['Tyler-TenantUrl'] });
      if (url.endsWith('/criteria')) return res({ Result: { PermitCriteria: {} } });
      return res({ Result: { TotalFound: 0, EntityResults: [] } });
    };
    await createRentonSource({ fetchImpl, sleep: noSleep }).issuedSince('2026-10-01');
    expect(seen[0]).toEqual({ url: 'https://permitting.rentonwa.gov/api/energov/search/criteria', tenant: 'RentonWaProd' });
  });
});
