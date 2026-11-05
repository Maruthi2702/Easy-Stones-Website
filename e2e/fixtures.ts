import type { Page } from 'playwright/test';

export const product = {
  id: 1, name: 'Calacatta Lincoln', category: 'Quartz', collectionType: 'Basic',
  availability: 'In Stock', image: '/images/test-slab.jpg', price: '$25.00'
};
export const staff = {
  id: 'u1', _id: 'u1', username: 'alex', name: 'Alex Stone', type: 'internal', role: 'admin',
  location: 'Seattle', assignedLocations: ['*'], pinnedTabs: [],
  permissions: ['view_dashboard', 'view_customers', 'view_pricelist', 'view_permits', 'view_inventory_analysis',
    'view_crossover_sheet', 'view_lost_sales', 'view_daily_report', 'view_delivery_schedule', 'view_checkins',
    'create_checkins', 'view_payments', 'view_fuel_man', 'view_freight_charges', 'view_all_holds',
    'view_route_planner', 'manage_users', 'manage_type_lists', 'edit_nav_order', 'view_purchasing']
};

/** Deterministic API boundary: no production backend, account, or database. */
export async function mockApi(page: Page, signedIn = false) {
  let authenticated = signedIn;
  await page.routeWebSocket('**/socket.io/**', socket => socket.close());
  await page.route('**/socket.io/**', route => route.abort());
  await page.route('https://maps.google.com/**', route => route.abort());
  await page.route('https://maps.googleapis.com/**', route => route.abort());
  await page.route('http://127.0.0.1:4175/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = [];
    let status = 200;
    if (path === '/api/auth/verify') body = authenticated ? { valid: true, authType: 'admin', role: 'admin' } : { valid: false };
    else if (path === '/api/auth/token') body = { token: 'test-token' };
    else if (path === '/api/user/me') body = staff;
    else if (path === '/api/customer/login') { authenticated = true; body = { user: staff }; }
    else if (path === '/api/auth/login') { authenticated = true; body = { success: true, admin: staff }; }
    else if (path === '/api/products') body = [product];
    else if (path === '/api/contact') body = { success: true };
    else if (path === '/api/customers') body = { customers: [], pages: 1, total: 0 };
    else if (path === '/api/admin/locations') body = [{ _id: 'loc1', name: 'Seattle' }];
    else if (path === '/api/salesreps') body = { data: [] };
    else if (path === '/api/dashboard/stats') body = { visits: 0, resources: 0, followUp: 0 };
    else if (path === '/api/dashboard/followups/panel') body = [];
    else if (path === '/api/permits/meta') body = { sources: [], checks: [], cities: [], cityCounties: {}, canExport: false, canRefresh: false, running: false };
    else if (path === '/api/permits') body = { items: [], counts: {}, total: 0 };
    else if (path === '/api/sales-dashboard/resources') body = [{ _id: 'f1', name: 'Team Catalog.pdf', type: 'file', createdAt: '2026-10-01' }];
    else if (path === '/api/inventory-analysis/filters') body = { categories: [], locations: ['Seattle'], statuses: [] };
    else if (path === '/api/inventory-analysis/summary') body = { totalItems: 0, distinctProductCount: 0, totalAvailableQty: 0, agingBuckets: [] };
    else if (path === '/api/inventory-analysis/items/grouped') body = { groups: [], total: 0 };
    else if (path === '/api/nav-order') body = { order: null };
    else if (path === '/api/checkin') body = { checkIns: [], total: 0, stats: { today: 0, month: 0, allTime: 0 } };
    else if (path === '/api/checkin/stats') body = { todayCount: 0, monthCount: 0, allTimeCount: 0 };
    else if (path === '/api/auth/change-password') body = { success: true, token: 'rotated-token' };
    else if (path.startsWith('/api/auth/invite/')) body = { valid: false };
    else if (path === '/api/admin/products/list') body = [product];
    else if (path === '/api/admin/products/1') body = product;
    else if (path === '/api/payments-received/locations') body = { locations: ['Seattle'] };
    else if (path === '/api/payments-received') body = { payments: [], day: { submitted: false, submittedBy: '', submittedAt: null, autoSubmitted: false }, today: '2026-11-05' };
    else if (path === '/api/payments-received/summary') body = { net: 0, count: 0, taken: 0, returned: 0, grid: {} };
    else if (path === '/api/customers/list') body = { partners: [], totalCount: 0, totalPages: 1 };
    else if (path === '/api/customers/view-counts') body = { incomplete: 0 };
    else if (path === '/api/customers/map/rep-counts') body = {};
    else if (path === '/api/accounting/fuel-man/metadata') body = { global: true, locations: ['Seattle'], drivers: [], permissions: ['view_fuel_man'] };
    else if (path === '/api/accounting/fuel-man/reports') body = { items: [], total: 0, page: 1, limit: 50 };
    else if (path === '/api/accounting/fuel-man/revision') body = { revision: 1 };
    else if (path === '/api/accounting/freight-charges') body = { items: [], total: 0, counts: {}, summary: {} };
    else if (path === '/api/holds') body = { items: [], total: 0, counts: {}, branches: ['Seattle'] };
    else if (path === '/api/daily-reports/locations') body = { locations: ['Seattle'], allLocations: ['Seattle'], canExportAll: true };
    else if (path === '/api/daily-reports/submitted-days') body = { days: [] };
    else if (/^\/api\/daily-reports\/\d{4}-\d{2}-\d{2}$/.test(path)) body = {
      report: { date: path.split('/').at(-1), location: 'Seattle', status: 'draft', notes: '', visitors: { homeowners: 0, fabricators: 0, designers: 0 },
        deliveries: { assigned: 0, capacity: null }, pickups: { assigned: 0, capacity: null }, returns: null, returnsSlabs: null, sinks: null, transfers: [], containers: [], payments: {} },
      derived: { noBranchTickets: 0 }, handSet: {}, slabRange: { low: 0, high: 0 }, transfersShippedEarlier: []
    };
    else if (path === '/api/delivery-columns') body = {};
    else if (path === '/api/presence/heartbeat') body = { success: true };
    // Unspecified APIs fail visibly; new dependencies need explicit fixtures.
    else if (!['/api/customers/dropdown', '/api/my-team', '/api/salesreps/options', '/api/schedule',
      '/api/dashboard/visits', '/api/dashboard/resources', '/api/lost-sales', '/api/crossover-sheet',
      '/api/easy-stones-colors', '/api/admin/users', '/api/admin/roles', '/api/visit-types',
      '/api/resource-types', '/api/resource-families', '/api/auth/logout', '/api/customer/logout', '/api/deliveries',
      '/api/customers/cities', '/api/customers/map', '/api/accounting/carriers'].includes(path)) {
      body = { message: `No browser fixture for ${path}` }; status = 501;
    }
    await route.fulfill({ status, json: body });
  });
}
