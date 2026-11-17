import { test, expect } from 'playwright/test';
import type { Page } from 'playwright/test';
import { mockApi } from './fixtures';

async function openCalendar(page: Page) {
    await mockApi(page, true);
    await page.clock.setFixedTime(new Date('2026-11-18T20:00:00Z'));
    await page.addInitScript(() => localStorage.setItem('checkin_theme', 'light'));
    const names = ['Slusher Luxury Homes', 'Dawson Construction LLC', 'Chuckanut Builders', 'Zion Builders', 'RMC Architects', 'NW GRANITE', 'SVC Interiors & Design, Inc.'];
    await page.route('**/api/schedule?**', route => {
        const day = new URL(route.request().url()).searchParams.get('start')?.slice(0, 10);
        return route.fulfill({ json: day === '2026-11-18' ? names.map((company, i) => ({
            _id: `s${i}`, customerId: { _id: `c${i}`, company },
            startTime: `2026-11-18T${String(11 + Math.floor((25 + i * 20) / 60)).padStart(2, '0')}:${String((25 + i * 20) % 60).padStart(2, '0')}:00.000`,
            activityType: 'Visit', status: 'Scheduled'
        })) : [] });
    });
    await page.goto('/sales?tab=dashboard');
    await page.locator('.dfx-card').filter({ hasText: 'CALENDAR' }).click();
    await expect(page.locator('.pl-grid--day .pl-item')).toHaveCount(names.length);
}

test('phone agenda switches Day and Month and keeps actions accessible in a contextual sheet', async ({ page, isMobile }, testInfo) => {
    test.skip(!isMobile, 'Phone-specific agenda');
    await openCalendar(page);
    await page.screenshot({ path: testInfo.outputPath('agenda.png') });
    await page.getByRole('button', { name: 'Search calendar', exact: true }).click();
    const search = page.getByRole('searchbox', { name: 'Search the calendar', exact: true });
    await search.fill('Dawson');
    await expect(page.locator('.pl-grid--day .pl-item')).toHaveCount(1);
    await page.getByRole('button', { name: 'Hide calendar search (filter active)', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Search calendar (filter active)', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Search calendar (filter active)', exact: true }).click();
    await search.fill('');
    await page.getByRole('button', { name: 'Hide calendar search', exact: true }).click();
    // Day and Month only; the date is the button that opens the calendar (no arrows, no Today).
    await expect(page.getByRole('group', { name: 'Calendar view' }).getByRole('button')).toHaveText(['Day', 'Month']);
    await expect(page.getByRole('button', { name: 'Previous', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Today', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Month', exact: true }).click();
    await expect(page.getByText('7 stops this month')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('month.png') });
    await page.getByRole('button', { name: /^Thursday, November 19.*no stops$/ }).click();
    await expect(page.locator('.pl-grid--day .pl-item')).toHaveCount(0);
    await page.getByRole('button', { name: 'Month', exact: true }).click();
    await page.getByRole('button', { name: /^Wednesday, November 18.*7 stops$/ }).click();
    await expect(page.locator('.pl-grid--day .pl-item')).toHaveCount(7);

    const more = page.getByRole('button', { name: 'More for Slusher Luxury Homes', exact: true });
    await more.click();
    const sheet = page.getByRole('dialog', { name: 'Slusher Luxury Homes', exact: true });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Directions', exact: true })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Open profile', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('activity-actions.png') });
    const rect = await sheet.boundingBox();
    expect(Math.round(rect!.y + rect!.height)).toBe(page.viewportSize()!.height);
    await sheet.getByRole('button', { name: 'Cancel', exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(sheet.getByRole('button', { name: 'Close activity actions' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(sheet).not.toBeVisible();
    await expect(more).toBeFocused();

    await more.click();
    await sheet.getByRole('button', { name: 'Edit schedule', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Edit activity', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await more.click();
    await sheet.getByRole('button', { name: 'Delete activity', exact: true }).click();
    await expect(page.getByText('Delete this scheduled activity?', { exact: true })).toBeVisible();
});

test('narrow phone keeps controls within the viewport and supports dark theme', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Phone-specific layout');
    await page.setViewportSize({ width: 320, height: 740 });
    await openCalendar(page);
    for (const selector of ['.dfx-head-tools', '.dfx-cards', '.pl-views', '.pl-title-wrap', '.pl-optimize', '.pl-search-toggle', '.pl-item']) {
        const rects = await page.locator(selector).evaluateAll(nodes => nodes.map(node => {
            const rect = node.getBoundingClientRect();
            return { left: rect.left, right: rect.right };
        }));
        for (const rect of rects) {
            expect(rect.left, selector).toBeGreaterThanOrEqual(0);
            expect(rect.right, selector).toBeLessThanOrEqual(320);
        }
    }
    await page.evaluate(() => document.body.classList.remove('light-theme-active'));
    await page.getByRole('button', { name: 'More for Slusher Luxury Homes', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Slusher Luxury Homes', exact: true })).toHaveCSS('background-color', 'rgb(28, 28, 30)');
});
