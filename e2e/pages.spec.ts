import { test, expect } from 'playwright/test';
import { mockApi, product } from './fixtures';

test.beforeEach(async ({ page }) => { await mockApi(page); });

test('visitors browse the collection, open a product, and return to its category', async ({ page }) => {
  await page.goto('/products');
  await page.getByRole('heading', { name: product.name }).click();
  await expect(page).toHaveURL(/\/product\/calacatta-lincoln$/);
  await expect(page.getByRole('heading', { name: product.name })).toBeVisible();
  await expect(page.getByText('$25.00', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: product.name })).toBeVisible();
});

test('contact validates required fields and confirms delivery', async ({ page }) => {
  let submissions = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/contact') submissions++; });
  await page.goto('/contact');
  await page.getByRole('button', { name: 'Send Message' }).click();
  expect(submissions).toBe(0);
  await page.getByPlaceholder('Name', { exact: true }).fill('Alex Stone');
  await page.getByPlaceholder('E-Mail').fill('alex@example.com');
  await page.getByPlaceholder('How can we help you?').fill('Please send a quote.');
  await page.getByRole('button', { name: 'Send Message' }).click();
  await expect(page.getByText(/Message sent successfully/)).toBeVisible();
  await expect(page.getByPlaceholder('Name', { exact: true })).toHaveValue('');
  expect(submissions).toBe(1);
});

test('warranty deep links and section navigation work', async ({ page }) => {
  await page.goto('/warranty?section=care');
  await expect(page.getByRole('heading', { name: 'Moda Quartz Care & Maintenance Guidelines' })).toBeVisible();
  await page.getByRole('button', { name: 'Warranty', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Download Warranty PDF' })).toBeVisible();
});

for (const path of ['/login', '/customer/login', '/admin/login']) {
  test(`login route ${path} opens its sign-in form`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByLabel(path === '/admin/login' ? 'Username' : 'Email or username', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  });
}

for (const path of ['/set-password', '/admin/set-password']) {
  test(`invitation route ${path} explains an expired link`, async ({ page }) => {
    await page.goto(`${path}?token=expired`);
    await expect(page.getByRole('heading', { name: 'This link has expired' })).toBeVisible();
  });
}

test('protected pages preserve the target URL through login', async ({ page }) => {
  await page.goto('/sales?tab=team_files');
  await expect(page.getByLabel('Email or username')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('redirect')).toBe('/sales?tab=team_files');
});

test('a staff login returns to the requested Sales page', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.goto('/sales?tab=team_files');
  await page.getByLabel('Email or username').fill('alex');
  await page.getByLabel('Password', { exact: true }).fill('test-password');
  await page.locator('button[type="submit"]').click();
  await expect(page.getByRole('heading', { name: 'Team Files', exact: true })).toBeVisible();
  await expect(page.getByText('Team Catalog.pdf')).toBeVisible();
  expect(failures).toEqual([]);
});
