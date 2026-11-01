import type { Loose } from '../types/records.ts';
// Lakewood: how the city's public permit portal (Clariti / OnCamino GraphQL)
// becomes leads — records trimmed from the real portal, 2026-11-01 — and the
// reader's paging, order check and issue-day lookup against a fake portal.
import { describe, it, expect } from 'vitest';
import lakewood, { lakewoodPermit, typeTail, splitAddress } from './rules/lakewood.ts';
import { createLakewoodSource } from './sources/lakewood.ts';
import { RULES, SOURCES, categoryFor, isUnsortedBuildingType } from './permitRules.ts';

const noSleep = async () => {};
const json = (body: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });

const NEW_HOME_ROW = {
  id: '764178', number: 'BLDG-2026-632', address: '12115 COCHISE LN SW', status: 'Issued', createdOn: '2026-05-07', issuedOn: '2026-10-29',
  tree: ['Building Applications', 'Residential', 'Single Family Home - New Construction']
};
const NEW_HOME_DETAIL = {
  description: 'New Residential Single Family Home', applicant: 'Jennifer Kearney', owner: '', contractor: 'Savage Framing and Contacting, LLC',
  sqft: '', units: '1.0', parcel: '0219118047', expiresOn: '2027-04-27T16:59:59-07:00'
};

describe('Lakewood rules', () => {
  it('is in Pierce County, as a city', () => {
    expect(RULES.lakewood).toBe(lakewood);
    expect(SOURCES.lakewood).toMatchObject({ county: 'pierce', kind: 'city' });
  });

  it('copies a permit from its list row and page', () => {
    expect(lakewoodPermit(NEW_HOME_ROW, NEW_HOME_DETAIL)).toMatchObject({
      source: 'lakewood', permitNumber: 'BLDG-2026-632', externalId: '764178', category: 'new_home', type: 'Residential',
      subtype: 'Single Family Home - New Construction', status: 'Issued', appliedOn: '2026-05-07', issuedOn: '2026-10-29', expiresOn: '2027-04-27',
      address: '12115 COCHISE LN SW', city: 'Lakewood', parcel: '0219118047', description: 'New Residential Single Family Home', units: 1, valuation: null,
      sourceUrl: 'https://lakewood_wa.claritilaunch.com/submissions/764178'
    });
    expect(lakewoodPermit(NEW_HOME_ROW, NEW_HOME_DETAIL).contacts).toMatchObject([
      { role: 'Contractor', company: 'Savage Framing and Contacting, LLC' }, { role: 'Applicant', name: 'Jennifer Kearney' }
    ]);
  });

  it('leaves the page’s fields unset without it, so a save keeps what was read before', () => {
    const p = lakewoodPermit(NEW_HOME_ROW);
    for (const k of ['contacts', 'description', 'parcel', 'units', 'sqft', 'expiresOn'] as const) expect(p[k], k).toBeUndefined();
  });

  it('takes a trailing city, state and ZIP off an address', () => {
    expect(splitAddress('12721 BRIDGEPORT WAY SW, Lakewood, WA 98499')).toEqual({ address: '12721 BRIDGEPORT WAY SW', zip: '98499' });
    expect(splitAddress('7909 59TH AVENUE CT W, UNIT N-201')).toEqual({ address: '7909 59TH AVENUE CT W, UNIT N-201', zip: '' });
    expect(lakewoodPermit({ ...NEW_HOME_ROW, address: '12721 BRIDGEPORT WAY SW, Lakewood, WA 98499' })).toMatchObject({ address: '12721 BRIDGEPORT WAY SW', zip: '98499' });
  });

  it('files an owner building their own project as the owner, not a company', () => {
    const p = lakewoodPermit({ ...NEW_HOME_ROW, tree: ['Building Applications', 'Residential', 'Minor Remodel'] }, { ...NEW_HOME_DETAIL, contractor: 'GEORGE SEBERINA (OWNER)', applicant: 'William K Araka' });
    expect(p.contacts).toMatchObject([{ role: 'Owner', name: 'GEORGE SEBERINA' }, { role: 'Applicant', name: 'William K Araka' }]);
    expect(p.contacts!.some((c: Loose) => c.company)).toBe(false);
  });

  it('sorts the city’s exact types and skips trades, roofs and outbuildings', () => {
    expect(typeTail(['Building Applications', 'Commercial', 'Mechanical '])).toEqual(['Commercial', 'Mechanical']);
    expect(categoryFor('lakewood', 'Residential', 'Single Family Home - New Construction')).toBe('new_home');
    expect(categoryFor('lakewood', 'Residential', 'Accessory Dwelling Unit - ADU')).toBe('adu');
    expect(categoryFor('lakewood', 'Residential', 'Major Remodel')).toBe('remodel');
    expect(categoryFor('lakewood', 'Residential', 'Minor Remodel')).toBe('remodel');
    expect(categoryFor('lakewood', 'Commercial', 'Minor Tenant Improvement')).toBe('commercial_remodel');
    expect(categoryFor('lakewood', 'Commercial', 'Commercial Building')).toBe('building_other');
    for (const [c, t] of [['Residential', 'Mechanical'], ['Residential', 'Re-Roof'], ['Residential', 'Accessory Structure'], ['Commercial', 'Permanent Sign'], ['Residential', 'Manufactured/Mobile Home'], ['Commercial', 'Change of Use or Occupancy']]) {
      expect(categoryFor('lakewood', c, t)).toBeNull();
      expect(isUnsortedBuildingType('lakewood', c, t)).toBe(false);
    }
  });

  it('reports a building type nobody has sorted', () => {
    expect(isUnsortedBuildingType('lakewood', 'Residential', 'Tiny House')).toBe(true);
    expect(isUnsortedBuildingType('lakewood', 'Residential', 'Major Remodel')).toBe(false);
  });
});

/** A fake portal: the type tree, the list (newest change first) and each permit's history and page. */
function fakePortal({ list, history, detail = {}, sorted = true }: { list: Loose[]; history: Record<string, Loose[]>; detail?: Record<string, Loose>; sorted?: boolean }) {
  const calls: { op: string; vars: Loose }[] = [];
  const fetchImpl = async (_url: string, init: Loose) => {
    const { query, variables } = JSON.parse(init.body);
    const op = /query (\w+)/.exec(query)![1];
    calls.push({ op, vars: variables });
    if (op === 'ProjectTypeTree') {
      return json({ data: { publicProjectTypes: { projectTypes: [
        { id: '15237', fullName: ['Building Applications', 'Residential', 'Single Family Home - New Construction'] },
        { id: '15248', fullName: ['Building Applications', 'Residential', 'Mechanical'] },
        { id: '15193', fullName: [' Land Use & Environmental Applications', 'Land Use'] }
      ] } } });
    }
    if (op === 'PublicEntryList') {
      const per = variables.perPage;
      const items = (sorted ? list : [...list].reverse()).slice((variables.page - 1) * per, variables.page * per);
      return json({ data: { publicEntryList: { items, metadata: { total: list.length, hasNextPage: variables.page * per < list.length } } } });
    }
    if (op === 'StatusHistory') return json({ data: { publicEntryFullDetails: { statusHistory: history[variables.entryId] } } });
    if (op === 'Details') {
      return json({ data: { publicEntryFullDetails: {
        entryDetails: { entryNumber: 'X', expiresAt: '2027-04-27T16:59:59-07:00' },
        entryMiscDetails: Object.entries({ 'Project Description': 'A house', 'Applicant Name': 'Jo', 'Contractor Name': 'Acme', 'Total Number of Units': '1.0', ...detail[variables.entryId] })
          .map(([friendlyName, v]) => ({ dataFieldValues: [{ formattedValue: v }], miscDetail: { dataField: { friendlyName } } })),
        primaryLocation: { apn: '123' }
      } } });
    }
    throw new Error(`unexpected ${op}`);
  };
  return { fetchImpl, calls };
}

const entry = (id: string, updatedAt: string, status = 'Issued', type = 'Single Family Home - New Construction', klass = 'Residential') => ({
  id, entryName: 'submission', entryNumber: `BLDG-2026-${id}`, fullLocation: `${id} MAIN ST SW`, workflowStatus: status,
  projectTypeFullName: ['Building Applications', klass, type], createdAt: '2026-05-07T15:02:41-07:00', updatedAt
});

describe('Lakewood reader', () => {
  it('reads issued permits from the status history and stops at older changes', async () => {
    const portal = fakePortal({
      list: [
        entry('1', '2026-10-30T10:00:00-07:00'),
        entry('2', '2026-10-29T10:00:00-07:00', 'Under Review'),
        entry('3', '2026-10-28T10:00:00-07:00', 'Closed', 'Mechanical'),
        entry('4', '2026-10-27T10:00:00-07:00', 'Finaled'),
        entry('5', '2026-09-01T10:00:00-07:00')
      ],
      history: {
        '1': [{ workflowStatus: 'Issued', updatedAt: '2026-10-29T15:56:11-07:00' }, { workflowStatus: 'Approved', updatedAt: '2026-10-26T12:20:12-07:00' }],
        // Issued last month, finaled since: last changed in the window, issued before it.
        '4': [{ workflowStatus: 'Finaled', updatedAt: '2026-10-27T10:00:00-07:00' }, { workflowStatus: 'Issued ', updatedAt: '2026-10-01T09:00:00-07:00' }]
      }
    });
    const source = createLakewoodSource({ fetchImpl: portal.fetchImpl, sleep: noSleep, pauseMs: 0 });
    const { rows, total } = await source.issuedSince('2026-10-15');
    expect(total).toBe(5);
    expect(rows.map((r: Loose) => [r.number, r.issuedOn])).toEqual([['BLDG-2026-1', '2026-10-29']]);
    // Only Building Applications types are asked for, and the older permit's history was never read.
    expect(portal.calls.find((c) => c.op === 'PublicEntryList')!.vars.filters.projectTypeIds).toEqual(['15237', '15248']);
    expect(portal.calls.filter((c) => c.op === 'StatusHistory').map((c) => c.vars.entryId).sort()).toEqual(['1', '4']);
  });

  it('keeps a permit issued in the window that was finaled after', async () => {
    const portal = fakePortal({
      list: [entry('7', '2026-10-31T10:00:00-07:00', 'Finaled')],
      history: { '7': [{ workflowStatus: 'Finaled', updatedAt: '2026-10-31T10:00:00-07:00' }, { workflowStatus: 'Issued', updatedAt: '2026-10-20T09:00:00-07:00' }] }
    });
    const { rows } = await createLakewoodSource({ fetchImpl: portal.fetchImpl, sleep: noSleep, pauseMs: 0 }).issuedSince('2026-10-15');
    expect(rows.map((r: Loose) => [r.number, r.issuedOn, r.status])).toEqual([['BLDG-2026-7', '2026-10-20', 'Finaled']]);
  });

  it('skips a permit that never was issued', async () => {
    const portal = fakePortal({
      list: [entry('8', '2026-10-31T10:00:00-07:00', 'Expired')],
      history: { '8': [{ workflowStatus: 'Expired', updatedAt: '2026-10-31T10:00:00-07:00' }, { workflowStatus: 'Submitted', updatedAt: '2026-05-01T10:00:00-07:00' }] }
    });
    const { rows } = await createLakewoodSource({ fetchImpl: portal.fetchImpl, sleep: noSleep, pauseMs: 0 }).issuedSince('2026-10-15');
    expect(rows).toEqual([]);
  });

  it('stops if the list stops being newest-first', async () => {
    const portal = fakePortal({
      list: [entry('1', '2026-10-30T10:00:00-07:00'), entry('2', '2026-10-29T10:00:00-07:00')],
      history: {}, sorted: false
    });
    await expect(createLakewoodSource({ fetchImpl: portal.fetchImpl, sleep: noSleep, pauseMs: 0 }).issuedSince('2026-10-01')).rejects.toThrow(/no longer newest-first/);
  });

  it('fails when the portal has no building types', async () => {
    const fetchImpl = async () => json({ data: { publicProjectTypes: { projectTypes: [{ id: '1', fullName: ['Land Use'] }] } } });
    await expect(createLakewoodSource({ fetchImpl, sleep: noSleep, pauseMs: 0 }).issuedSince('2026-10-01')).rejects.toThrow(/no "Building Applications" types/);
  });

  it('surfaces an error the portal sends in a 200 answer', async () => {
    const fetchImpl = async () => json({ errors: [{ message: 'Field does not exist' }] });
    await expect(createLakewoodSource({ fetchImpl, sleep: noSleep, pauseMs: 0 }).issuedSince('2026-10-01')).rejects.toThrow(/Field does not exist/);
  });

  it('reads a permit’s page by the field names the portal shows', async () => {
    const portal = fakePortal({ list: [], history: {}, detail: { '9': { 'Property Owner Name': 'Pat Owner', 'Square Footage': '2400' } } });
    const detail = await createLakewoodSource({ fetchImpl: portal.fetchImpl, sleep: noSleep, pauseMs: 0 }).details('9');
    expect(detail).toMatchObject({ description: 'A house', applicant: 'Jo', owner: 'Pat Owner', contractor: 'Acme', sqft: '2400', units: '1.0', parcel: '123' });
    expect(lakewood.toPermit(NEW_HOME_ROW, detail).units).toBe(1);
  });
});
