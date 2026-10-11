import { describe, it, expect } from 'vitest';
import {
  rangeFrom, splitChecks, nextSort, ariaSort, formatDay, formatMonth, formatMoney, sizeLine, whenLine, sourceStatus, checkStatus, checksAttention, leadContact, contactPerson,
  customerOf, permitExportRows, placeGroups, placeQuery, permitPdfRows, permitPdfScope, permitPdfUrl, permitFileName
} from './permitView.js';

const NOW = new Date('2026-10-11T19:00:00Z'); // 12:00 PM Pacific

describe('dates and numbers', () => {
  it('counts a range back from today on the Pacific calendar, today included', () => {
    expect(rangeFrom('7', NOW)).toBe('2026-10-05');
    expect(rangeFrom('30', NOW)).toBe('2026-09-12');
    expect(rangeFrom('183', NOW)).toBe('2026-04-12');
    expect(rangeFrom('nonsense', NOW)).toBe('2026-09-12');
  });

  it('formats days, months, money and size', () => {
    expect(formatDay('2026-10-09')).toBe('Oct 9, 2026');
    expect(formatDay(null)).toBe('');
    expect(formatMonth('2026-08')).toBe('August 2026');
    expect(formatMoney(307360)).toBe('$307,360');
    expect(formatMoney(699502.6)).toBe('$699,502.60');
    expect(formatMoney(null)).toBe('');
    expect(sizeLine({ sqft: 2808, units: null })).toBe('2,808 sq ft');
    expect(sizeLine({ sqft: 44758, units: 55 })).toBe('44,758 sq ft · 55 units');
    expect(sizeLine({})).toBe('');
  });

  it('says when, in Pacific time', () => {
    expect(whenLine('2026-10-11T12:04:00Z', NOW)).toBe('today 5:04 AM');
    expect(whenLine('2026-10-10T12:02:00Z', NOW)).toBe('yesterday 5:02 AM');
    expect(whenLine('2026-10-08T12:03:00Z', NOW)).toBe('Oct 8, 5:03 AM');
  });
});

const run = (over = {}) => ({ finishedAt: '2026-10-11T12:04:00Z', ok: true, error: '', detailErrors: 0, latestIssuedOn: '2026-10-09', ...over });

describe('sorting', () => {
  it('sorts a column highest / newest first, then the other way', () => {
    expect(nextSort('issued_desc', 'value')).toBe('value_desc');
    expect(nextSort('value_desc', 'value')).toBe('value_asc');
    expect(nextSort('value_asc', 'value')).toBe('value_desc');
    expect(nextSort('value_desc', 'issued')).toBe('issued_desc');
    expect(ariaSort('value_desc', 'value')).toBe('descending');
    expect(ariaSort('value_asc', 'value')).toBe('ascending');
    expect(ariaSort('value_desc', 'issued')).toBe('none');
  });
});

describe('source status', () => {
  it('reads fine after a good morning pull', () => {
    const s = sourceStatus({ label: 'Whatcom County', lastRun: run(), lastOk: run() }, NOW);
    expect(s).toMatchObject({ tone: 'ok', text: 'Whatcom County: updated today 5:04 AM', through: ' · its data runs to Oct 9, 2026' });
  });

  it('warns when the last pull failed, and says what is shown instead', () => {
    const s = sourceStatus({
      label: 'Bellingham',
      lastRun: run({ ok: false, error: 'Bellingham answered 500: error' }),
      lastOk: run({ finishedAt: '2026-10-10T12:02:00Z' })
    }, NOW);
    expect(s.tone).toBe('warn');
    expect(s.text).toBe('Bellingham: the last pull failed today 5:04 AM — Bellingham answered 500: error. Showing what was saved yesterday 5:02 AM.');
  });

  it('warns when the morning pull hasn’t run for over a day', () => {
    const s = sourceStatus({ label: 'Bellingham', lastRun: run({ finishedAt: '2026-10-09T12:02:00Z' }), lastOk: run() }, NOW);
    expect(s.tone).toBe('warn');
    expect(s.text).toMatch(/hasn’t run since/);
  });

  it('says when permits came without contacts, and when nothing has run yet', () => {
    expect(sourceStatus({ label: 'Whatcom County', lastRun: run({ detailErrors: 2 }), lastOk: run() }, NOW).text).toMatch(/2 permits without contacts/);
    expect(sourceStatus({ label: 'Whatcom County', lastRun: null, lastOk: null }, NOW).tone).toBe('none');
    expect(sourceStatus({ label: 'Whatcom County', lastRun: { finishedAt: null }, lastOk: null }, NOW).tone).toBe('busy');
  });
});

describe('county report check', () => {
  it('reads a match, a difference and an error', () => {
    expect(checkStatus({ month: '2026-08', ok: true, matched: 37, missingFromApp: [], notInReport: [] }).text)
      .toBe('Accuracy check, August 2026: matches the county’s report — all 37 lead permits accounted for');
    expect(checkStatus({ month: '2026-08', ok: false, matched: 35, missingFromApp: ['A'], notInReport: ['B'], notInCountySearch: [] }))
      .toEqual({ tone: 'warn', text: 'Accuracy check, August 2026: 2 permits differ from the county’s report' });
    expect(checkStatus({ month: '2026-08', error: 'No permit numbers found' }).tone).toBe('warn');
  });
});

describe('month so far', () => {
  const search = (source, over = {}) => ({ source, month: '2026-10', method: 'search', ok: true, matched: 20, missingFromApp: [], notFoundAgain: [], ...over });

  it('reads each source’s check for the month so far', () => {
    expect(checkStatus(search('whatcom')).text).toBe('Accuracy check, October 2026 so far (Whatcom County): all 20 lead permits found again by a separate county search by permit number');
    expect(checkStatus(search('bellingham', { matched: 7 })).text).toBe('Accuracy check, October 2026 so far (Bellingham): all 7 lead permits found again by a separate query of the city’s data');
    expect(checkStatus(search('whatcom', { ok: false, missingFromApp: ['A'], notFoundAgain: [] }))).toEqual({ tone: 'warn', text: 'Accuracy check, October 2026 so far (Whatcom County): 1 permit differ from a separate county search by permit number' });
  });

  it('puts this month’s checks and the newest report on top, the rest under Details', () => {
    const checks = [
      search('bellingham'), search('whatcom'),
      { source: 'whatcom', month: '2026-08', method: 'report', ok: true },
      { source: 'whatcom', month: '2026-07', ok: true },
      search('whatcom', { month: '2026-09' })
    ];
    const { top, rest } = splitChecks(checks, NOW);
    expect(top.map((c) => `${c.source} ${c.month} ${c.method || 'report'}`)).toEqual(['whatcom 2026-10 search', 'bellingham 2026-10 search', 'whatcom 2026-08 report']);
    expect(rest.map((c) => c.month)).toEqual(['2026-07', '2026-09']);
  });
});

describe('what stays on the page outside Detailed Checks', () => {
  const search = (source, over = {}) => ({ source, month: '2026-10', method: 'search', ok: true, matched: 20, missingFromApp: [], notFoundAgain: [], ...over });
  const fine = [
    { id: 'whatcom', label: 'Whatcom County', lastRun: run(), lastOk: run() },
    { id: 'bellingham', label: 'Bellingham', lastRun: run(), lastOk: run() }
  ];

  it('is empty when every pull and check is fine', () => {
    expect(checksAttention(fine, [search('whatcom'), search('bellingham'), { source: 'whatcom', month: '2026-08', method: 'report', ok: true }], NOW)).toEqual([]);
  });

  it('keeps a failed, stale or running pull and new unsorted building types', () => {
    const lines = checksAttention([
      { ...fine[0], lastRun: run({ unsortedTypes: [{ type: 'Barn', count: 2 }] }) },
      { ...fine[1], lastRun: run({ ok: false, error: 'timeout' }) },
      { id: 'other', label: 'Other', lastRun: { finishedAt: null }, lastOk: null }
    ], [], NOW);
    expect(lines.map((l) => [l.id, l.tone])).toEqual([['whatcom-unsorted', 'warn'], ['bellingham', 'warn'], ['other', 'busy']]);
    expect(lines[0].text).toBe('Whatcom County: new building types not sorted yet — Barn (2)');
  });

  it('keeps a check on top that differs, but not an older month already under it', () => {
    const lines = checksAttention(fine, [
      search('whatcom', { ok: false, missingFromApp: ['A'] }),
      { source: 'whatcom', month: '2026-07', method: 'report', ok: false, missingFromApp: ['B'], notInReport: [] },
      { source: 'whatcom', month: '2026-08', method: 'report', ok: true }
    ], NOW);
    expect(lines).toEqual([{ id: 'whatcom-2026-10-search', tone: 'warn', text: expect.stringMatching(/1 permit differ/) }]);
  });
});

describe('contacts on a row', () => {
  const gc = { kind: 'contractor', company: 'KVF Construction', name: 'Vladimir Kolesnikov', phone: '3607397535' };
  const owner = { kind: 'owner', company: 'Ann Lee', name: '' };

  it('leads with the contractor', () => {
    expect(leadContact({ contacts: [gc, owner] })).toEqual({ contact: gc, note: '' });
  });

  it('falls back to the owner, saying why', () => {
    expect(leadContact({ contacts: [{ kind: 'contractor', company: 'OWNER AS CONTRCT EXEMPT PER RCW18.27.090' }, owner] })).toEqual({ contact: owner, note: 'Owner-builder' });
    expect(leadContact({ contacts: [{ kind: 'contractor', company: 'TBD' }, owner] })).toEqual({ contact: owner, note: 'Contractor not named yet' });
    expect(leadContact({ contacts: [owner] })).toEqual({ contact: owner, note: 'No contractor listed' });
    expect(leadContact({ contacts: [] })).toEqual({ contact: null, note: 'No contractor listed' });
  });

  it('shows the person only when it isn’t the company again', () => {
    expect(contactPerson(gc)).toBe('Vladimir Kolesnikov');
    expect(contactPerson({ company: 'RAVEN RIDGE', name: 'Raven Ridge' })).toBe('');
  });

  it('finds an existing customer among the contacts', () => {
    expect(customerOf({ contacts: [owner, { ...gc, customer: { id: '1', name: 'KVF' } }] })).toEqual({ id: '1', name: 'KVF' });
    expect(customerOf({ contacts: [owner] })).toBeNull();
  });
});

describe('Excel export', () => {
  it('puts contractor, owner and applicant side by side', () => {
    const [row] = permitExportRows([{
      source: 'whatcom', permitNumber: 'SFR2026-00212', category: 'new_home', type: 'Building (Residential) - SFR - New Construction', subtype: 'New Construction',
      status: 'Issued', issuedOn: '2026-10-06', appliedOn: '2026-05-18', address: '2996 BROOK LN', city: 'Sedro Woolley', zip: '98284', parcel: '370429',
      description: 'New SFR', valuation: 307360, sqft: 2808, units: null, sourceUrl: 'https://example.com/p',
      contacts: [
        { kind: 'contractor', company: 'KVF Construction', name: 'Vladimir Kolesnikov', phone: '3607397535', email: 'kvf1616@gmail.com', customer: { id: '1', name: 'KVF' } },
        { kind: 'applicant', company: 'Larry Stoner', name: 'Jesse Stoner', phone: '3602200552', email: '' }
      ]
    }]);
    expect(row).toMatchObject({
      Source: 'Whatcom County (outside city limits)', 'Permit #': 'SFR2026-00212', Category: 'New home',
      Type: 'Building (Residential) - SFR - New Construction', Issued: '2026-10-06', Valuation: 307360, Units: '',
      Contractor: 'KVF Construction', 'Contractor contact': 'Vladimir Kolesnikov', 'Contractor phone': '(360) 739-7535',
      'Contractor email': 'kvf1616@gmail.com', Owner: '', Applicant: 'Larry Stoner', 'Applicant phone': '(360) 220-0552',
      'Existing customer': 'KVF', Link: 'https://example.com/p'
    });
  });
});

describe('the place filter', () => {
  it('offers who issued the permit first, then each city', () => {
    const groups = placeGroups(['Bellingham', 'Ferndale']);
    expect(groups.map((g) => g.label)).toEqual(['Issued by', 'City']);
    expect(groups[0].options).toEqual([
      { value: 'source:whatcom', label: 'Whatcom County (outside city limits)' },
      { value: 'source:bellingham', label: 'City of Bellingham' }
    ]);
    expect(groups[1].options[1]).toEqual({ value: 'city:Ferndale', label: 'Ferndale' });
    expect(placeGroups().map((g) => g.label)).toEqual(['Issued by']);
  });

  it('reads a pick as the list query — an issuer or a city, never both', () => {
    expect(placeQuery('')).toEqual({ source: '', city: '' });
    expect(placeQuery('source:bellingham')).toEqual({ source: 'bellingham', city: '' });
    expect(placeQuery('city:Bellingham')).toEqual({ source: '', city: 'Bellingham' });
    expect(placeQuery('city:Point Roberts: East')).toEqual({ source: '', city: 'Point Roberts: East' });
    expect(placeQuery('source:nowhere')).toEqual({ source: '', city: '' });
  });
});

describe('the PDF', () => {
  const permit = {
    source: 'whatcom', permitNumber: 'SFR2026-00212', category: 'new_home', issuedOn: '2026-10-06', address: '1 MAIN ST', city: 'Ferndale',
    description: 'New single family home', valuation: 300000,
    contacts: [{ kind: 'contractor', company: 'KVF Construction', name: 'Vlad K', phone: '3607397535' }]
  };

  it('shows each permit as main values with a quieter line under them', () => {
    expect(permitPdfRows([permit])[0]).toEqual({
      issued: 'Oct 6, 2026', issuer: 'Whatcom County', number: 'SFR2026-00212', kind: 'New home', address: '1 MAIN ST', city: 'Ferndale',
      work: 'New single family home', value: formatMoney(300000), lead: 'KVF Construction', leadSub: 'Vlad K · (360) 739-7535'
    });
  });

  it('says why there is no contractor, with the owner when there is one', () => {
    const owner = { ...permit, contacts: [{ kind: 'contractor', company: 'OWNER AS CONTRACTOR' }, { kind: 'owner', name: 'Pat Lee' }] };
    expect(permitPdfRows([owner])[0]).toMatchObject({ lead: 'Pat Lee', leadSub: 'Owner-builder' });
    expect(permitPdfRows([{ ...permit, contacts: [] }])[0]).toMatchObject({ lead: 'No contractor listed', leadSub: '' });
  });

  it('heads the PDF with the filters in words', () => {
    expect(permitPdfScope({ source: 'whatcom', category: 'new_home', from: '2026-09-12', to: '2026-10-11', q: ' kvf ' }))
      .toBe('Whatcom County (outside city limits) · New home · Sep 12, 2026 – Oct 11, 2026 · matching “kvf”');
    expect(permitPdfScope({ city: 'Ferndale' })).toBe('Ferndale · All kinds of work · All dates');
    expect(permitPdfScope()).toBe('Whatcom County and Bellingham · All kinds of work · All dates');
  });

  it('links to the PDF for exactly the list’s filters', () => {
    expect(permitPdfUrl('https://api.x', { source: '', city: 'Point Roberts', category: 'adu', from: '2026-09-12', to: '2026-10-11', q: ' ', sort: 'value_desc' }))
      .toBe('https://api.x/api/permits/export.pdf?city=Point+Roberts&category=adu&from=2026-09-12&to=2026-10-11&sort=value_desc');
    expect(permitPdfUrl('', {}, { download: true })).toBe('/api/permits/export.pdf?download=1');
  });

  it('names the files after the place and dates', () => {
    expect(permitFileName({ source: 'bellingham', from: '2026-09-12', to: '2026-10-11' })).toBe('permits-bellingham-2026-09-12-to-2026-10-11.xlsx');
    expect(permitFileName({ city: 'Point Roberts', from: '2026-09-12', to: '2026-10-11' }, 'pdf')).toBe('permits-point-roberts-2026-09-12-to-2026-10-11.pdf');
    expect(permitFileName({})).toBe('permits-whatcom-bellingham-start-to-today.xlsx');
  });
});
