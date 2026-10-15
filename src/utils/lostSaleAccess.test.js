import { describe, it, expect } from 'vitest';
import { canViewLostSales, canEditLostSales, canDeleteLostSales } from './lostSaleAccess.js';

const as = (role, ...permissions) => ({ role, permissions });

describe('Lost Sales access — the screen\'s rules, now the API\'s too', () => {
  it('View, Edit and Delete each open by their own switch', () => {
    expect(canViewLostSales(as('csr', 'view_lost_sales'))).toBe(true);
    expect(canEditLostSales(as('csr', 'edit_lost_sales'))).toBe(true);
    expect(canDeleteLostSales(as('csr', 'delete_lost_sales'))).toBe(true);
    expect(canEditLostSales(as('csr', 'view_lost_sales'))).toBe(false);
    expect(canDeleteLostSales(as('sales_rep', 'view_lost_sales', 'edit_lost_sales'))).toBe(false);
  });

  it('the older manage_lost_sales allows everything', () => {
    const old = as('custom', 'manage_lost_sales');
    expect([canViewLostSales(old), canEditLostSales(old), canDeleteLostSales(old)]).toEqual([true, true, true]);
  });

  it('keeps the screen\'s role-name allowances: admin sees it, admin and director edit and delete', () => {
    expect(canViewLostSales(as('admin'))).toBe(true);
    expect(canViewLostSales(as('director'))).toBe(false);
    for (const role of ['admin', 'director']) {
      expect(canEditLostSales(as(role))).toBe(true);
      expect(canDeleteLostSales(as(role))).toBe(true);
    }
  });

  it('gives a kiosk, a website customer or nobody nothing', () => {
    for (const user of [as('kiosk', 'create_checkins'), { role: 'customer', type: 'customer', permissions: [] }, null]) {
      expect([canViewLostSales(user), canEditLostSales(user), canDeleteLostSales(user)]).toEqual([false, false, false]);
    }
  });
});
