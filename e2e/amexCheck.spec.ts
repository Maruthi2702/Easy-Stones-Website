import { test, expect } from 'playwright/test';
import { mockApi } from './fixtures';

/** Credit Card Receipts → Statements (the Amex check), desktop and phone, with the API mocked. */
const line = (reference: string, o: Record<string, unknown> = {}) => ({
  reference, date: '2026-11-05', description: 'CHEVRON 0207730          KENT WA', cardMember: 'ALEX STONE', digits: '12345', cents: 5840, kind: 'charge',
  amexCategory: 'Transportation-Fuel', cityState: 'KENT WA', cardId: 'c1', cardLabel: 'ALEX12345', holderId: 'u1', holderName: 'Alex Stone',
  expenseId: 'e1', expenseStatus: 'missing', status: 'missing', ...o
});
const VIEW = {
  lines: [
    line('r1'),
    line('r2', { date: '2026-11-04', description: 'JINYA RAMEN BAR SEATTLE WA', cents: 11579, amexCategory: 'Restaurant-Restaurant', status: 'matched', expenseStatus: 'waiting' }),
    line('r3', { date: '2026-11-03', description: 'MYFREIGHTWORLDCARRIEOVERLAND PARK KS', cents: 35000, status: 'matched', expenseStatus: 'approved' }),
    line('r4', { date: '2026-11-02', description: 'ONLINE PAYMENT - THANK YOU', cents: -4052163, kind: 'credit', amexCategory: '', status: 'no_receipt', expenseId: null, expenseStatus: null }),
    line('r5', { date: '2026-11-06', description: 'OFFICE DEPOT #612', cardMember: 'SRINI MANAM', digits: '92473', cardId: null, cardLabel: '', holderName: '', status: 'no_card', expenseId: null, expenseStatus: null })
  ],
  unknownCards: [{ digits: '92473', cardMember: 'SRINI MANAM', charges: 58, cents: 1234567, first: '2026-11-01', last: '2026-11-07', suggestedUserId: 'u2' }],
  missingNow: { count: 12, cents: 98765 },
  imports: [{ id: 'i1', fileName: "Amex activity Oct'26.xlsx", periodFrom: '2026-09-29', periodTo: '2026-10-29', lines: 1065, added: 1065, chargesCents: 23254199, byName: 'Alex Stone', at: '2026-11-20T17:00:00Z' }],
  people: [{ id: 'u1', name: 'Alex Stone', role: 'admin', location: 'Seattle', active: true, card: 'ALEX12345' }, { id: 'u2', name: 'Srini Manam', role: 'sales_rep', location: 'Seattle', active: true, card: '' }],
  missingFrom: '2026-11-01'
};
const PREVIEW = {
  preview: true, lines: 1065, added: 1065, known: 0, charges: 1038, chargesCents: 23254199,
  counts: { missing: { count: 0, cents: 0 }, matched: { count: 2, cents: 7000 }, no_card: { count: 0, cents: 0 }, unassigned: { count: 3, cents: 12000 }, before_start: { count: 1036, cents: 22900000 }, no_receipt: { count: 27, cents: -25351290 } },
  unknownCards: VIEW.unknownCards, people: VIEW.people, check: { linked: 2, created: 0, retired: 0, cardsFound: 0 }, period: { from: '2026-09-29', to: '2026-10-29' }, missingFrom: '2026-11-01'
};

test('Cards shows a card with no holder yet and offers to assign it', async ({ page }) => {
  await page.route('http://127.0.0.1:4175/api/card-receipts/cards', route => route.fulfill({ json: {
    cards: [{ _id: 'k1', userId: 'u1', label: 'ALEX12345', issuer: 'amex', lastDigits: '12345', active: true, amexName: 'ALEX STONE', statementName: 'ALEX STONE' },
      { _id: 'k2', userId: '', label: 'LORI94370', issuer: 'amex', lastDigits: '94370', active: true, amexName: '', statementName: 'LORI DANIELS' }],
    people: [{ id: 'u1', name: 'Alex Stone', role: 'admin', location: 'Seattle', active: true }]
  } }));
  await page.goto('/sales?tab=card_receipts');
  await page.getByRole('tab', { name: 'Cards' }).click();
  await expect(page.getByText('2 active · 1 not assigned yet')).toBeVisible();
  await expect(page.getByText('LORI94370').first()).toBeVisible();
  await expect(page.getByText('Not assigned yet').first()).toBeVisible();
  await page.getByRole('button', { name: 'Actions for card LORI94370' }).click();
  await page.getByRole('menuitem', { name: 'Assign to a person' }).click();
  await expect(page.getByLabel('Amex card member')).toHaveValue('LORI DANIELS');
  // Starts as the name on the statements, and can be typed over.
  await page.getByLabel('Amex card member').fill('lori d daniels');
  await expect(page.getByLabel('Amex card member')).toHaveValue('LORI D DANIELS');
  await page.screenshot({ path: `test-results/amex-edit-card.png` });
});

test.beforeEach(async ({ page }) => {
  await mockApi(page, true);
  await page.route('http://127.0.0.1:4175/api/card-receipts/statements?**', route => route.fulfill({ json: VIEW }));
  await page.route('http://127.0.0.1:4175/api/card-receipts/statements/preview', route => route.fulfill({ json: PREVIEW }));
});

test('Statements shows the Amex check, filters by status and previews an upload', async ({ page }, info) => {
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.goto('/sales?tab=card_receipts');
  await page.getByRole('tab', { name: 'Statements' }).click();
  await expect(page.getByText('12 receipts still missing · $987.65')).toBeVisible();
  await expect(page.getByText('Cards not set up · 1')).toBeVisible();
  const phone = info.project.name === 'phone';
  if (!phone) {
    await expect(page.locator('.ccr-st-lines tbody tr')).toHaveCount(5);
    await page.locator('.ccr-tile').filter({ hasText: 'Missing receipt' }).click();
    await expect(page.locator('.ccr-st-lines tbody tr')).toHaveCount(1);
    await page.locator('.ccr-tile').filter({ hasText: 'Missing receipt' }).click();
  } else {
    await expect(page.locator('.ccr-st-card')).toHaveCount(5);
  }
  const width = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(width).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `test-results/amex-${info.project.name}-tab.png`, fullPage: true });

  await page.getByRole('button', { name: 'Upload Amex activity' }).click();
  await page.locator('input[type="file"][aria-label="Amex activity file"]').setInputFiles({ name: 'amex.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('x') });
  await expect(page.locator('.fm-section-title').filter({ hasText: 'Sep 29 – Oct 29, 2026' })).toBeVisible();
  await expect(page.getByText(/are before 11-01-2026/)).toBeVisible();
  await expect(page.getByText(/are on cards with no login yet/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upload and check' })).toBeEnabled();
  await page.screenshot({ path: `test-results/amex-${info.project.name}-upload.png`, fullPage: true });
  expect(failures).toEqual([]);
});
