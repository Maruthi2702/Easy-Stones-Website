// The two source readers against fake servers: how far they read, what makes
// them stop, and that a short or out-of-order answer fails the run instead of
// quietly saving less.
import { describe, it, expect } from 'vitest';
import { createWhatcomSource } from './sources/whatcom.js';
import { createBellinghamSource, bellinghamWhere } from './sources/bellingham.js';
import { parseArchive } from './countyReport.js';

const noSleep = async () => {};
const json = (body, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });

const CRITERIA = { Result: { Keyword: '', SearchModule: 1, PermitCriteria: { PageNumber: 0, PageSize: 0, SortBy: null }, PageNumber: 0, PageSize: 0 } };
const row = (n, day) => ({ CaseId: `id-${n}`, CaseNumber: `SFR2026-${String(n).padStart(5, '0')}`, CaseType: 'Building (Residential) - SFR - New Construction', IssueDate: day ? `${day}T00:00:00` : null });

/** A fake county whose search answers `pages` (arrays of rows) by page number. */
function fakeCounty(pages, { failFirst = 0 } = {}) {
  const calls = [];
  let failures = failFirst;
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) : null });
    if (failures > 0) { failures -= 1; return { ok: false, status: 503, text: async () => '<html>busy</html>' }; }
    if (url.endsWith('/search/criteria')) return json(CRITERIA);
    if (url.endsWith('/search/search')) {
      const body = JSON.parse(init.body);
      return json({ Result: { TotalFound: 999, EntityResults: pages[body.PageNumber - 1] || [] } });
    }
    const m = url.match(/permits\/permit\/(.+)$/);
    if (m) return json({ Result: { PermitNumber: m[1], ValuationValue: 1, Contacts: [] } });
    return json({}, 404);
  };
  return { fetchImpl, calls };
}

describe('Whatcom County reader', () => {
  it('reads newest-first until the issue dates fall before the start', async () => {
    const county = fakeCounty([
      [row(5, '2026-10-09'), row(4, '2026-10-08')],
      [row(3, '2026-09-12'), row(2, '2026-09-10'), row(1, '2026-09-01')],
      [row(0, '2026-08-01')]
    ]);
    const src = createWhatcomSource({ fetchImpl: county.fetchImpl, sleep: noSleep });
    const r = await src.issuedSince('2026-09-10');
    expect(r.rows.map((x) => x.CaseNumber)).toEqual(['SFR2026-00005', 'SFR2026-00004', 'SFR2026-00003', 'SFR2026-00002']);
    expect(r.pages).toBe(2);
    const search = county.calls.find((c) => c.url.endsWith('/search/search')).body;
    expect(search).toMatchObject({ SearchModule: 1, FilterModule: 2, SortBy: 'IssueDate', SortAscending: false, PageSize: 100 });
    expect(search.PermitCriteria).toMatchObject({ SortBy: 'IssueDate', SortAscending: false, PageNumber: 1, PageSize: 100 });
  });

  it('counts a permit seen twice once (a new one pushed it down a page)', async () => {
    const county = fakeCounty([[row(3, '2026-10-09'), row(2, '2026-10-08')], [row(2, '2026-10-08'), row(1, '2026-09-01')]]);
    const r = await createWhatcomSource({ fetchImpl: county.fetchImpl, sleep: noSleep }).issuedSince('2026-10-01');
    expect(r.rows.map((x) => x.CaseId)).toEqual(['id-3', 'id-2']);
  });

  it('stops at the first permit with no issue date', async () => {
    const county = fakeCounty([[row(3, '2026-10-09'), row(2, null), row(1, '2026-10-05')]]);
    const r = await createWhatcomSource({ fetchImpl: county.fetchImpl, sleep: noSleep }).issuedSince('2026-10-01');
    expect(r.rows.map((x) => x.CaseId)).toEqual(['id-3']);
  });

  it('fails when the results aren’t newest-first, rather than miss permits', async () => {
    const county = fakeCounty([[row(2, '2026-10-01'), row(1, '2026-10-09')]]);
    await expect(createWhatcomSource({ fetchImpl: county.fetchImpl, sleep: noSleep }).issuedSince('2026-09-01')).rejects.toThrow(/newest-first/);
  });

  it('tries again after a failed answer', async () => {
    const county = fakeCounty([[row(1, '2026-10-09')], []], { failFirst: 2 });
    const r = await createWhatcomSource({ fetchImpl: county.fetchImpl, sleep: noSleep }).issuedSince('2026-10-01');
    expect(r.rows).toHaveLength(1);
  });

  it('gives up after three failed answers', async () => {
    const county = fakeCounty([], { failFirst: 3 });
    await expect(createWhatcomSource({ fetchImpl: county.fetchImpl, sleep: noSleep }).issuedSince('2026-10-01')).rejects.toThrow(/other than JSON/);
  });

  it('reads one permit’s details', async () => {
    const county = fakeCounty([]);
    const d = await createWhatcomSource({ fetchImpl: county.fetchImpl, sleep: noSleep }).details('abc');
    expect(d.ValuationValue).toBe(1);
  });
});

/** A fake ArcGIS layer holding `features`, which can claim a different count. */
function fakeLayer(features, { claimCount = null } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    const params = new URL(url).searchParams;
    calls.push(Object.fromEntries(params));
    if (params.get('returnCountOnly') === 'true') return json({ count: claimCount ?? features.length });
    const offset = Number(params.get('resultOffset'));
    const n = Number(params.get('resultRecordCount'));
    return json({ features: features.slice(offset, offset + n).map((attributes) => ({ attributes })) });
  };
  return { fetchImpl, calls };
}

describe('Bellingham reader', () => {
  it('looks up a disappeared permit without restricting the issue date', async () => {
    const calls = [];
    const attributes = { PERMIT_NO: 'BLD2025-0500', ISSUED: null, STATUS: 'RTI HOLD' };
    const source = createBellinghamSource({ sleep: noSleep, fetchImpl: async url => {
      calls.push(Object.fromEntries(new URL(url).searchParams));
      return json({ features: [{ attributes }] });
    } });
    expect(await source.findByNumber('BLD2025-0500')).toEqual(attributes);
    expect(calls[0]).toMatchObject({ where: "PERMIT_NO = 'BLD2025-0500'", returnGeometry: 'false', resultRecordCount: '2' });
    expect(calls[0].outFields).toContain('ISSUED');
    await source.findByNumber("BLD' OR 1=1");
    expect(calls[1].where).toBe("PERMIT_NO = 'BLD'' OR 1=1'");
  });

  it('refuses ambiguous, malformed and invalid-date lookup answers', async () => {
    for (const data of [
      {}, { features: [{ attributes: {} }, { attributes: {} }] },
      { features: [], exceededTransferLimit: true },
      { features: [{ attributes: { PERMIT_NO: 'BLD2025-0500', ISSUED: 'invalid' } }] }
    ]) {
      const source = createBellinghamSource({ sleep: noSleep, fetchImpl: async () => json(data) });
      await expect(source.findByNumber('BLD2025-0500')).rejects.toThrow();
    }
    const missing = createBellinghamSource({ sleep: noSleep, fetchImpl: async () => json({ features: [] }) });
    expect(await missing.findByNumber('BLD2025-0500')).toBeNull();
  });

  it('asks for building permits issued since the start, in pages', async () => {
    const features = Array.from({ length: 2500 }, (_, i) => ({ OBJECTID: i + 1, PERMIT_NO: `BLD-${i}` }));
    const layer = fakeLayer(features);
    const r = await createBellinghamSource({ fetchImpl: layer.fetchImpl, sleep: noSleep }).issuedSince('2026-04-11');
    expect(r.rows).toHaveLength(2500);
    expect(r.pages).toBe(3);
    expect(layer.calls[0].where).toBe(bellinghamWhere('2026-04-11'));
    expect(layer.calls[1]).toMatchObject({ orderByFields: 'OBJECTID', resultOffset: '0', resultRecordCount: '1000', returnGeometry: 'false' });
  });

  it('fails when it gets fewer permits than the city counted', async () => {
    const layer = fakeLayer([{ OBJECTID: 1 }, { OBJECTID: 2 }], { claimCount: 3 });
    await expect(createBellinghamSource({ fetchImpl: layer.fetchImpl, sleep: noSleep }).issuedSince('2026-04-11')).rejects.toThrow(/said 3 permits but sent 2/);
  });

  it('builds a safe query', () => {
    expect(bellinghamWhere('2026-04-11')).toMatch(/^ISSUED >= DATE '2026-04-11' AND PermitType IN \('NEW CONSTRUCTION SINGLE FAMILY OR DUPLEX'/);
    expect(() => bellinghamWhere("2026-04-11' OR 1=1 --")).toThrow();
  });
});

describe('county report archive', () => {
  it('lists single-month “Permits Issued” reports, newest first', () => {
    const html = `
      <a href="Archive.aspx?ADID=16082" target="_blank"><span>Permit Issued August 2026  </span></a>
      <a href="Archive.aspx?ADID=16081" target="_blank"><span>Contractor Listing on Issued Permits August 2026</span></a>
      <a href="Archive.aspx?ADID=16070" target="_blank"><span>Permits Issued Listing March 2026</span></a>
      <a href="Archive.aspx?ADID=15001" target="_blank"><span>Building Permit Issued Report April-June 2025</span></a>`;
    expect(parseArchive(html, 'https://wa-whatcomcounty.civicplus.com/Archive.aspx?AMID=56')).toEqual([
      { month: '2026-08', title: 'Permit Issued August 2026', url: 'https://wa-whatcomcounty.civicplus.com/Archive.aspx?ADID=16082' },
      { month: '2026-03', title: 'Permits Issued Listing March 2026', url: 'https://wa-whatcomcounty.civicplus.com/Archive.aspx?ADID=16070' }
    ]);
  });
});
