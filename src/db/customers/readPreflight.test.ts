import { describe, it, expect } from 'vitest';
import { customerReadPreflight } from './readPreflight.ts';

const resource = { _id: 'resource', date: '2026-11-09', createdAt: '2026-11-05T10:00:00.000' };
const customer = { _id: 'customer', status: 'Onboarded', location: 'Seattle', resources: [resource] };

describe('customer read cutover preconditions', () => {
  it('accepts ordinary model-written records and explicit null/blank statuses (the field exists)', () => {
    expect(customerReadPreflight([customer, { ...customer, status: null }, { ...customer, status: '' }])).toEqual([]);
  });
  it('rejects a missing source status rather than hiding a numeric lead-count difference', () => {
    const { status: _, ...withoutStatus } = customer;
    expect(customerReadPreflight([withoutStatus])).toEqual(['customer customer: missing status would change the dashboard lead count']);
  });
  it('rejects a BSON resource date whose MongoDB range uses the created day instead', () => {
    expect(customerReadPreflight([{ ...customer, resources: [{ ...resource, date: new Date('2026-11-09T00:00:00Z') }] }]))
      .toEqual(['resources resource: dashboard range day would change from "2026-11-05" to "2026-11-09"']);
  });
  it('rejects a blank string date, whose MongoDB range never falls back to createdAt', () => {
    expect(customerReadPreflight([{ ...customer, resources: [{ ...resource, date: '' }] }])).toHaveLength(1);
  });
  it('accepts a missing resource date with an unchanged created day', () => {
    expect(customerReadPreflight([{ ...customer, resources: [{ ...resource, date: undefined }] }])).toEqual([]);
  });
  it('rejects fallback created-day changes caused by a branch-clock conversion', () => {
    expect(customerReadPreflight([{ ...customer, resources: [{ ...resource, date: undefined, createdAt: new Date('2026-11-05T01:00:00Z') }] }]))
      .toEqual(['resources resource: dashboard range day would change from "2026-11-05" to "2026-11-04"']);
  });
  it('checks the same legacy non-string day case for visits', () => {
    expect(customerReadPreflight([{ ...customer, resources: [], visits: [{ ...resource, date: new Date('2026-11-09T00:00:00Z') }] }]))
      .toEqual(['visits resource: dashboard range day would change from "2026-11-05" to "2026-11-09"']);
  });
});
