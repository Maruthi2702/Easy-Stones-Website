import { readFile } from 'node:fs/promises';
import { read, utils } from 'xlsx';
import { expect, test } from 'playwright/test';
import { mockApi, staff } from '../../../e2e/fixtures.ts';

// These exercise the real UI in Chromium; API responses are controlled fixtures.
// They do not claim to test a deployed backend or actual OCR/S3 services.
const expense = (id: string, over: Record<string, unknown> = {}) => ({
  id, userId: 'u1', holderName: 'Alex Stone', cardId: 'c1', cardLabel: 'ALEX12345', location: 'Seattle',
  date: '2026-11-05', merchant: 'Fuel station', cents: 1001, subtotalCents: null, taxCents: null, tipCents: null,
  category: 'fuel', subcategory: '', customerId: '', customerName: '', attendees: [], purpose: '', note: '', recurring: false,
  receiptUrl: '', lostReason: 'Printer failed', status: 'waiting', approval: null, sentBack: null, voided: null,
  createdAt: '2026-11-05T12:00:00Z', updatedAt: '2026-11-05T12:00:00Z', history: [], mine: true, canDecide: false, ...over
});

test.beforeEach(async ({ page }) => {
  await mockApi(page, true);
  await page.route('**/api/user/me', r => r.fulfill({ json: { ...staff, permissions: [...staff.permissions, 'export_card_receipts'] } }));
});

test('wrong, empty and oversized files are rejected before any upload request', async ({ page }) => {
  const uploads: string[] = [];
  page.on('request', r => { if (r.url().includes('/card-receipts/attachments')) uploads.push(r.url()); });
  await page.goto('/sales?tab=card_receipts');
  await page.getByLabel('Add receipt', { exact: true }).click();
  const picker = page.locator('input[type=file][accept="application/pdf,image/*"]');
  await picker.setInputFiles({ name: 'invoice.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('not a receipt') });
  await expect(page.getByRole('alert')).toContainText('EXE file');
  await picker.setInputFiles({ name: 'empty.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(0) });
  await expect(page.getByRole('alert')).toContainText('empty');
  await picker.setInputFiles({ name: 'huge.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
  await expect(page.getByRole('alert')).toContainText('over 10 MB');
  expect(uploads).toEqual([]);
});

test('failed save retains entered receipt details and permits retry', async ({ page }) => {
  const saves: Record<string, unknown>[] = [];
  await page.route('**/api/card-receipts/expenses', async r => {
    saves.push(r.request().postDataJSON());
    await r.fulfill({ status: 503, json: { message: 'Accounting is temporarily unavailable. Try again.' } });
  });
  await page.goto('/sales?tab=card_receipts');
  await page.getByLabel('Add receipt', { exact: true }).click();
  await page.getByRole('button', { name: /Lost Receipt/ }).click();
  await page.getByLabel('Edit bill details', { exact: true }).click();
  await page.locator('#ccr-merchant').fill('Retry Shop');
  await page.locator('#ccr-total').fill('10.01');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.locator('#ccr-lost').fill('Printer failed');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
  await expect(page.locator('#ccr-lost')).toHaveValue('Printer failed');
  await expect(page.getByText('Retry Shop', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeEnabled();
  expect(saves).toHaveLength(1);
  expect(saves[0]).toMatchObject({ merchant: 'Retry Shop', total: '10.01', lostReason: 'Printer failed' });
});

test('approval requires a lost-receipt comment and handles a stale-decision rejection', async ({ page }, info) => {
  const e = expense('waiting', { userId: 'u2', holderName: 'Other Holder', mine: false, canDecide: true });
  await page.route('**/api/card-receipts/expenses?**', r => r.fulfill({ json: { expenses: new URL(r.request().url()).searchParams.get('scope') === 'waiting' ? [e] : [] } }));
  const decisions: Record<string, unknown>[] = [];
  await page.route('**/api/card-receipts/expenses/waiting/approve', async r => {
    decisions.push(r.request().postDataJSON());
    await r.fulfill({ status: 409, json: { message: 'This receipt changed after you opened it. Look at it again, then decide.', changed: true } });
  });
  await page.goto('/sales?tab=card_receipts');
  await page.getByRole('tab', { name: /Waiting for me/ }).click();
  if (info.project.name === 'phone') await page.locator('.ccr-card').click();
  else await page.getByRole('button', { name: 'Open Fuel station $10.01', exact: true }).click();
  const approveButton = page.getByRole('button', { name: /^Approve(?: receipt)?$/ });
  await expect(approveButton).toBeDisabled();
  const oldSendBack = page.getByRole('button', { name: 'Send back', exact: true });
  if (await oldSendBack.count()) await expect(oldSendBack).toBeDisabled();
  else {
    await page.getByRole('dialog').getByRole('button', { name: 'More', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Send back', exact: true })).toBeDisabled();
    await page.getByRole('dialog').getByRole('button', { name: 'More', exact: true }).click();
  }
  await page.locator('#ccr-comment').fill('  Business purchase verified  ');
  await approveButton.click();
  await expect(page.getByRole('alert')).toContainText('changed after you opened it');
  expect(decisions).toEqual([{ comment: 'Business purchase verified', expectedUpdatedAt: e.updatedAt }]);
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('export downloads exact filtered rows and cent amounts, excludes voids, and does not create formulas', async ({ page }, info) => {
  const rows = [
    expense('a', { merchant: '=1+1', cents: 29, status: 'approved', note: '=SUM(1,1)' }),
    expense('b', { merchant: 'Fuel station', cents: 1, status: 'draft' }),
    expense('c', { merchant: 'Voided shop', cents: 99900, voided: { at: '2026-11-05', by: 'Alex', reason: 'Wrong' } })
  ];
  await page.route('**/api/card-receipts/expenses?**', r => r.fulfill({ json: { expenses: rows } }));
  await page.goto('/sales?tab=card_receipts');
  if (info.project.name === 'phone') await expect(page.locator('.ccr-shown')).toContainText('$0.30');
  else await expect(page.locator('.ccr-tile.is-total .ccr-tile-v')).toHaveText('$0.30');
  await expect(page.getByText('Voided shop', { exact: true })).toHaveCount(0);
  await page.locator('.ccr').getByRole('button', { name: 'More', exact: true }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Export this view to Excel' }).click();
  const file = await downloaded;
  const book = read(await readFile((await file.path())!), { type: 'buffer' });
  const sheet = book.Sheets['Card receipts']!;
  const exported = utils.sheet_to_json<Record<string, unknown>>(sheet);
  expect(exported).toHaveLength(2);
  expect(exported.reduce((sum, row) => sum + Math.round(Number(row['Spent Amount']) * 100), 0)).toBe(30);
  expect(sheet.E2).toMatchObject({ t: 's', v: '=1+1' });
  expect(sheet.E2.f).toBeUndefined();
  await page.getByRole('searchbox', { name: 'Search expenses', exact: true }).fill('Fuel station');
  await page.locator('.ccr').getByRole('button', { name: 'More', exact: true }).click();
  const filteredDownload = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Export this view to Excel' }).click();
  const filteredFile = await filteredDownload;
  const filteredBook = read(await readFile((await filteredFile.path())!), { type: 'buffer' });
  expect(utils.sheet_to_json(filteredBook.Sheets['Card receipts']!)).toEqual([expect.objectContaining({ Description: 'FUEL STATION', 'Spent Amount': 0.01 })]);
});

test('a holder without a card gets a setup message and no Add receipt action', async ({ page }) => {
  await page.route('**/api/card-receipts/me', async r => {
    await r.fulfill({ json: { user: { id: 'u1', name: 'Alex Stone' }, card: null, categories: [], approverRoles: [], today: '2026-11-05' } });
  });
  await page.goto('/sales?tab=card_receipts');
  await expect(page.getByText('You don’t have a company card set up yet.', { exact: false })).toBeVisible();
  await expect(page.getByLabel('Add receipt', { exact: true })).toHaveCount(0);
});

test('a plain holder sees neither card administration nor the export action', async ({ page }) => {
  await page.route('**/api/user/me', r => r.fulfill({ json: { ...staff, role: 'sales_rep', permissions: ['use_card_receipts'] } }));
  await page.goto('/sales?tab=card_receipts');
  await expect(page.getByLabel('Add receipt', { exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Cards', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Statements', exact: true })).toHaveCount(0);
  await expect(page.locator('.ccr').getByRole('button', { name: 'More', exact: true })).toHaveCount(0);
});

test('CC-10: a failed approval-queue request displays an error instead of saying nothing is waiting', async ({ page }) => {
  await page.route('**/api/card-receipts/expenses?**', r => {
    if (new URL(r.request().url()).searchParams.get('scope') === 'waiting') {
      return r.fulfill({ status: 503, json: { message: 'Approval queue is temporarily unavailable.' } });
    }
    return r.fulfill({ json: { expenses: [] } });
  });
  await page.goto('/sales?tab=card_receipts');
  await page.getByRole('tab', { name: /Waiting for me/ }).click();
  await expect(page.locator('.ccr').getByRole('alert')).toContainText('Approval queue is temporarily unavailable.', { timeout: 3000 });
  await expect(page.getByText('Nothing is waiting for you', { exact: true })).toHaveCount(0);
});
