import { describe, it, expect } from 'vitest';
import { deliveryViewMode, isDeliveryDriver, DELIVERY_PERMISSIONS as P } from './deliveryAccess.js';

describe('deliveryViewMode', () => {
  it('gives Driver view the driver screen, even alongside Edit', () => {
    expect(deliveryViewMode({ permissions: [P.VIEW, P.DRIVER_VIEW] })).toBe('driver');
    expect(deliveryViewMode({ permissions: [P.VIEW, P.EDIT, P.DRIVER_VIEW] })).toBe('driver');
  });

  it('gives Edit the full office board', () => {
    expect(deliveryViewMode({ permissions: [P.VIEW, P.EDIT] })).toBe('office');
  });

  it('gives View alone the read-only board', () => {
    expect(deliveryViewMode({ permissions: [P.VIEW] })).toBe('sales');
  });

  it('ignores the role name entirely', () => {
    expect(deliveryViewMode({ role: 'admin', permissions: [P.VIEW] })).toBe('sales');
    expect(deliveryViewMode({ role: 'manager', permissions: [P.VIEW] })).toBe('sales');
    expect(deliveryViewMode({ role: 'driver', permissions: [P.VIEW] })).toBe('sales');
    expect(deliveryViewMode({ role: 'sales_rep', permissions: [P.VIEW, P.EDIT] })).toBe('office');
    expect(deliveryViewMode({ role: 'csr', permissions: [P.VIEW, P.DRIVER_VIEW] })).toBe('driver');
  });

  it('does not hand out the full board to someone with no delivery permissions', () => {
    expect(deliveryViewMode({ role: 'admin', permissions: ['manage_users'] })).toBe('sales');
    expect(deliveryViewMode({ permissions: [] })).toBe('sales');
    expect(deliveryViewMode(null)).toBe('sales');
  });
});

describe('isDeliveryDriver', () => {
  it('follows the Driver view permission only', () => {
    expect(isDeliveryDriver({ permissions: [P.DRIVER_VIEW] })).toBe(true);
    expect(isDeliveryDriver({ role: 'driver', permissions: [P.VIEW] })).toBe(false);
    expect(isDeliveryDriver({ role: 'logistics' })).toBe(false);
    expect(isDeliveryDriver(undefined)).toBe(false);
  });
});
