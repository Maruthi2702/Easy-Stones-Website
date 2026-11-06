import { test, expect } from 'playwright/test';
import { mockApi, staff } from './fixtures';

test.beforeEach(async ({ page }) => { await mockApi(page, true); });

for (const [tab, heading] of [
  ['team_files', 'Team Files'], ['inventory_analysis', 'Inventory Analysis'], ['lost_sales', 'Lost Sales Tracker'],
  ['crossover_sheet', 'Crossover Sheet'], ['profile', 'User Profile'], ['permits', 'Permits'],
  ['pricelist', 'Confidential Pricing Sheet'], ['users', 'Users'], ['roles', 'Roles & Permissions'], ['locations', 'Locations'],
  ['nav_order', 'Side Nav Order'],
  ['dashboard', 'Dashboard'], ['customers', 'Customers'], ['payments', 'Payments'], ['holds', 'Holds'],
  ['fuel_man', 'Fuel Man'], ['freight', '3rd-Party Freight'], ['delivery_schedule', 'Delivery Schedule'],
  ['daily_report', 'Daily Work Report'], ['visit_types', 'Visit Types'], ['resource_types', 'Resource Types'],
  ['checkin', 'Visitor Check-In Log']
]) {
  test(`Sales opens ${tab} with its real components`, async ({ page }) => {
    const failures: string[] = [];
    page.on('pageerror', error => failures.push(error.message));
    await page.goto(`/sales?tab=${tab}`);
    await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible();
    await expect(page.getByText('Something went wrong', { exact: true })).toHaveCount(0);
    expect(failures).toEqual([]);
  });
}

test('Admin opens the product editor', async ({ page }) => {
  await page.goto('/admin');
  await page.getByText('Calacatta Lincoln', { exact: true }).click();
  await expect(page.locator('input[value="Calacatta Lincoln"]')).toBeVisible();
});

test('Route Planner explains a missing map configuration', async ({ page }) => {
  await page.goto('/sales?tab=route_planner');
  await expect(page.getByRole('heading', { name: 'The map needs a Google Maps key' })).toBeVisible();
});

test('Team Files filters the loaded folder', async ({ page }) => {
  await page.goto('/sales?tab=team_files');
  await expect(page.getByText('Team Catalog.pdf')).toBeVisible();
  await page.getByRole('textbox', { name: 'Search this folder' }).fill('missing');
  await expect(page.getByText('Team Catalog.pdf')).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(page.getByText('Team Catalog.pdf')).toBeVisible();
});

test('Customers retains the selected tab and search across page switches and refreshes aged rows quietly', async ({ page }) => {
  const now = new Date('2026-11-05T20:00:00Z');
  await page.clock.setFixedTime(now);
  let requests = 0;
  let releaseRefresh!: () => void;
  const refreshGate = new Promise<void>(resolve => { releaseRefresh = resolve; });
  let refresh = false;
  await page.route('http://127.0.0.1:4175/api/customers/list?**', async route => {
    requests++;
    if (refresh) await refreshGate;
    await route.fulfill({ json: {
      partners: [{ _id: 'c1', company: refresh ? 'Pacific Granite Updated' : 'Pacific Granite', type: 'Builder', city: 'Seattle' }],
      totalCount: 1, totalPages: 1
    } });
  });
  await page.goto('/sales?tab=customers');
  await expect(page.getByText('Pacific Granite', { exact: true }).first()).toBeVisible();
  await page.getByRole('tab', { name: /^Partners/ }).click();
  const search = page.getByRole('searchbox', { name: 'Search customers', exact: true });
  const searched = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/customers/list' && url.searchParams.get('search') === 'Pacific';
  });
  await search.fill('Pacific');
  await searched;
  await search.blur();
  const warmRequests = requests;

  // Exercise the shell's real browser-history navigation without reloading it.
  const leaveCustomers = async () => {
    await page.evaluate(() => {
      history.pushState({}, '', '/sales?tab=pricelist');
      dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page.getByRole('heading', { name: 'Confidential Pricing Sheet', exact: true })).toBeVisible();
    await expect(search).not.toBeVisible();
  };
  await leaveCustomers();
  await page.goBack();
  await expect(search).toHaveValue('Pacific');
  await expect(page.getByRole('tab', { name: /^Partners/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Pacific Granite', { exact: true }).first()).toBeVisible();
  expect(requests).toBe(warmRequests);

  await leaveCustomers();
  await page.clock.setFixedTime(new Date(now.getTime() + 3 * 60 * 1000));
  refresh = true;
  await page.goBack();
  await expect.poll(() => requests).toBe(warmRequests + 1);
  await expect(search).toHaveValue('Pacific');
  await expect(page.getByText('Pacific Granite', { exact: true }).first()).toBeVisible();
  await expect(page.locator('.cl-sk:visible')).toHaveCount(0);
  releaseRefresh();
  await expect(page.getByText('Pacific Granite Updated', { exact: true }).first()).toBeVisible();
});

test('My team checks the people list and unchecking a person keeps the other teammates', async ({ page }) => {
  await page.route('http://127.0.0.1:4175/api/user/me', route => route.fulfill({ json: { ...staff, permissions: [...staff.permissions, 'view_all_visits'] } }));
  await page.route('http://127.0.0.1:4175/api/salesreps', route => route.fulfill({ json: { data: [
    { ...staff, displayName: 'Alex Stone' },
    { _id: 'u2', username: 'jesus', displayName: 'Jesus B.', role: 'sales_rep', location: 'Seattle', assignedLocations: ['Seattle'] },
    { _id: 'u3', username: 'bart', displayName: 'Bart A.', role: 'sales_rep', location: 'Kent', assignedLocations: ['Kent'] }
  ] } }));
  await page.goto('/sales?tab=dashboard');
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByLabel('People', { exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Jesus B.', exact: true })).toBeVisible();
  const teamRequest = page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.pathname === '/api/dashboard/visits' && !url.searchParams.has('reps');
  });
  await page.getByRole('checkbox', { name: 'My team', exact: true }).click();
  await teamRequest;
  for (const name of [/Alex Stone/, 'Jesus B.', 'Bart A.']) {
    await expect(page.getByRole('checkbox', { name })).toHaveAttribute('aria-checked', 'true');
  }
  const subsetRequest = page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.pathname === '/api/dashboard/visits' && url.searchParams.get('reps') === 'u1,u3';
  });
  await page.getByRole('checkbox', { name: 'Jesus B.', exact: true }).click();
  await subsetRequest;
  await expect(page.getByRole('checkbox', { name: 'Jesus B.', exact: true })).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('checkbox', { name: 'Bart A.', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('checkbox', { name: /Alex Stone/ })).toHaveAttribute('aria-checked', 'true');
});

test.describe('Delivery date defaults', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });

  test('header Add uses today and a day-specific Add uses that day', async ({ page, isMobile }) => {
    await page.clock.setFixedTime(new Date('2026-11-05T20:00:00Z'));
    await page.route('http://127.0.0.1:4175/api/user/me', route => route.fulfill({ json: {
      ...staff, permissions: [...staff.permissions, 'edit_delivery_schedule']
    } }));
    await page.route('http://127.0.0.1:4175/api/salesreps', route => route.fulfill({ json: { data: [
      { _id: 'angel', username: 'angel', name: 'Angel', displayName: 'Angel', role: 'driver', isDeliveryDriver: true, isActive: true, assignedLocations: ['Seattle'] }
    ] } }));
    await page.goto('/sales?tab=delivery_schedule');
    await page.getByTitle('Previous Week', { exact: true }).click();
    await page.getByRole('button', { name: 'Add delivery', exact: true }).click();
    await expect(page.locator('#df-date')).toContainText('Thu, Nov 5, 2026');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    if (isMobile) {
      await page.locator('.ux-day-pill-card').filter({ hasText: 'FRI' }).click();
      await page.getByTitle('Add stop for Angel', { exact: true }).click();
    } else {
      await page.getByTitle('Add delivery — Angel on Friday', { exact: true }).click();
    }
    await expect(page.locator('#df-date')).toContainText('Fri, Oct 30, 2026');
  });
});

test.describe('Payments location filters', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });

  test('admin can view All locations with combined totals and return to a branch', async ({ page, isMobile }) => {
    await page.clock.setFixedTime(new Date('2026-11-05T20:00:00Z'));
    await page.route('http://127.0.0.1:4175/api/user/me', route => route.fulfill({ json: {
      ...staff, permissions: [...staff.permissions, 'add_payments', 'edit_payments', 'void_payments']
    } }));
    const payment = (id: string, location: string, cents: number) => ({
      id, location, cents, date: '2026-11-05', customerId: `c-${id}`, customerName: `${location} Company`,
      method: 'cash', invoice: '', reference: '', note: '', enteredBy: 'Alex', createdAt: '2026-11-05T18:00:00Z',
      updatedBy: 'Alex', updatedAt: '2026-11-05T18:00:00Z', voided: null, history: []
    });
    const rows = [payment('p1', 'Seattle', 10000), payment('p2', 'Spokane', 20000)];
    await page.route('http://127.0.0.1:4175/api/payments-received**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/locations')) return route.fulfill({ json: { locations: ['Seattle', 'Spokane'] } });
      if (url.pathname !== '/api/payments-received') return route.fallback();
      const location = url.searchParams.get('location');
      await route.fulfill({ json: { payments: location === '*' ? rows : rows.filter(row => row.location === location),
        day: { submitted: location === 'Seattle', submittedBy: 'Alex', submittedAt: null, autoSubmitted: false }, today: '2026-11-05' } });
    });
    await page.goto('/sales?tab=payments');
    await expect(page.getByText('Seattle Company', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    await page.locator('#pay-filter-location').click();
    await page.getByRole('option', { name: 'All locations', exact: true }).click();
    const list = page.locator(isMobile ? '.pay-cards' : '.pay-table');
    await expect(list).toContainText('Seattle Company');
    await expect(list).toContainText('Spokane Company');
    await expect(list).toContainText('Seattle');
    await expect(list).toContainText('Spokane');
    await expect(page.locator('.pay-shown strong')).toHaveText('$300.00');
    await expect(page.getByRole('button', { name: 'Add payment', exact: true })).toBeDisabled();
    await expect(page.getByRole('status')).toContainText('Choose a location');
    await page.locator('#pay-filter-location').click();
    await page.getByRole('option', { name: /^Spokane/ }).click();
    await expect(list).not.toContainText('Seattle Company');
    await expect(list).toContainText('Spokane Company');
    await expect(page.getByRole('button', { name: 'Add payment', exact: true })).toBeEnabled();
  });
});
