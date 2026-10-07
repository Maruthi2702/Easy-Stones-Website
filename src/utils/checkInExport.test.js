import { describe, it, expect } from 'vitest';
import { checkInExportRows, collectAllCheckIns, checkInExportFileName } from './checkInExport.js';

describe('checkInExportRows', () => {
  it('includes the location and rep, and tolerates missing fields', () => {
    const [row] = checkInExportRows([{ createdAt: '2026-10-05T17:30:00Z', location: 'Kent', name: 'Ann', phone: '555', salesRep: 'Sam' }]);
    expect(row).toMatchObject({ Location: 'Kent', Name: 'Ann', Phone: '555', 'Company/Contact Name': '', 'Sales Rep': 'Sam' });
    expect(row.Date).not.toBe('');
    expect(checkInExportRows([{}])[0]).toMatchObject({ Date: '', Time: '', Location: '' });
  });

  it('dates and times are on the branch clock, with its zone when it isn\'t the exporter\'s', () => {
    const atl = { createdAt: '2026-10-01T04:30:00Z', location: 'Atlanta' }; // 12:30 AM Oct 1 in Atlanta
    expect(checkInExportRows([atl], { viewerZone: 'America/Los_Angeles' })[0]).toMatchObject({ Date: 'Oct 1, 2026', Time: '12:30 AM EDT' });
    expect(checkInExportRows([atl], { viewerZone: 'America/New_York' })[0]).toMatchObject({ Date: 'Oct 1, 2026', Time: '12:30 AM' });
  });
});

describe('collectAllCheckIns', () => {
  const pages = (n, per = 2) => async (page) => ({ list: Array.from({ length: per }, (_, i) => ({ id: `${page}-${i}` })), totalPages: n, total: n * per });

  it('fetches every page', async () => {
    const r = await collectAllCheckIns(pages(3));
    expect(r.rows).toHaveLength(6);
    expect(r).toMatchObject({ total: 6, truncated: false });
  });

  it('says when it stopped at the page limit', async () => {
    const r = await collectAllCheckIns(pages(5), { maxPages: 2 });
    expect(r.rows).toHaveLength(4);
    expect(r).toMatchObject({ total: 10, truncated: true });
  });

  it('stops with an error instead of writing a partial file', async () => {
    const failing = async (page) => { if (page === 2) throw new Error('page 2 failed'); return { list: [{}], totalPages: 3 }; };
    await expect(collectAllCheckIns(failing)).rejects.toThrow('page 2 failed');
  });
});

describe('checkInExportFileName', () => {
  it('names the branch when there is one', () => {
    const d = new Date('2026-10-05T12:00:00Z');
    expect(checkInExportFileName('Salt Lake City', d)).toBe('checkin-log-Salt_Lake_City-2026-10-05.xlsx');
    expect(checkInExportFileName('', d)).toBe('checkin-log-2026-10-05.xlsx');
  });
});
