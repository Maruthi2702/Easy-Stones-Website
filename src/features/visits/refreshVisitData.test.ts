// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { globalPartnersCache } from '../customers/list/listOptions';
import { refreshVisitData } from './refreshVisitData';

describe('refreshVisitData', () => {
  it('clears the Customers list cache, tells the list, and refreshes dashboard visits', () => {
    (globalPartnersCache as Record<string, unknown>).k = { rows: [] };
    const changed = vi.fn();
    window.addEventListener('customers:changed', changed);
    const refreshVisits = vi.fn();
    refreshVisitData(refreshVisits);
    window.removeEventListener('customers:changed', changed);
    expect(Object.keys(globalPartnersCache)).toHaveLength(0);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(refreshVisits).toHaveBeenCalledTimes(1);
  });
});
