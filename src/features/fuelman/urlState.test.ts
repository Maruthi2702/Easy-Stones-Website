import { describe, expect, it } from 'vitest';
import { readFuelLocation, withFuelLocation } from './urlState';
const id = 'a'.repeat(24);
describe('Fuel Man address state', () => {
  it('reads a report, view and tab and falls back safely', () => {
    expect(readFuelLocation(`?tab=fuel_man&fm_report=${id}&fm_tab=missing`)).toEqual({ report: id, view: 'reports', tab: 'missing', unknownOnly: false });
    expect(readFuelLocation('?fm_report=nope&fm_tab=bogus&fm_view=totals')).toEqual({ report: '', view: 'totals', tab: 'drivers', unknownOnly: false });
  });
  it('writes only its own params and keeps the others', () => {
    const href = withFuelLocation('http://x/sales?tab=fuel_man&fm_report=old', { report: id, view: 'reports', tab: 'lines', unknownOnly: true });
    expect(href).toBe(`/sales?tab=fuel_man&fm_report=${id}&fm_tab=lines&fm_unknown=1`);
    expect(withFuelLocation(`http://x${href}`, { report: '', view: 'reports', tab: 'drivers', unknownOnly: false })).toBe('/sales?tab=fuel_man');
  });
  it('round-trips', () => {
    const where = { report: id, view: 'reports' as const, tab: 'allocations' as const, unknownOnly: false };
    expect(readFuelLocation(new URL(`http://x${withFuelLocation('http://x/sales', where)}`).search)).toEqual(where);
  });
});
