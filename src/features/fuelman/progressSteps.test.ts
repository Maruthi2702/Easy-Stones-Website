import { describe, expect, it } from 'vitest';
import { currentStep, reviewSteps } from './progressSteps';
import type { ReportDetail } from '../../fuelman/types';
const base = (over: Partial<ReportDetail['review']>, status: ReportDetail['status'] = 'draft') =>
  ({ status, review: { ready: false, drivers: [], missing: [], ...over } }) as unknown as ReportDetail;
describe('approval steps', () => {
  it('counts what is left and lights the first unfinished step', () => {
    const steps = reviewSteps(base({ drivers: [{ driverKey: '', amounts: { other: 0 } }, { driverKey: 'u', amounts: { other: 500 } }] as never, missing: [{ resolved: false }, { resolved: true }] as never }));
    expect(steps.map(s => s.status)).toEqual(['1 left', '1 left', '1 left', 'Not yet']);
    expect(currentStep(steps)).toBe('match');
  });
  it('is ready only when the server says so', () => {
    const steps = reviewSteps(base({ ready: true }));
    expect(steps.map(s => s.status)).toEqual(['Done', 'Done', 'Done', 'Ready']);
    expect(currentStep(steps)).toBe('approve');
  });
});
