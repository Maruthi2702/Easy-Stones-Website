import { test, expect } from 'playwright/test';
import { mockApi } from './fixtures';

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
