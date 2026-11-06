import { test, expect } from 'playwright/test';
import type { Page, WebSocketRoute } from 'playwright/test';
import { mockApi, staff } from './fixtures';
import { narrowPeople, visiblePeople } from '../src/utils/teamScope';

async function dashboardFixture(page: Page, access: 'all' | 'branches' | 'own') {
    await mockApi(page, true);
    await page.clock.setFixedTime(new Date('2026-11-05T20:00:00Z'));
    const user = { ...staff, role: access === 'all' ? 'admin' : 'sales_rep', location: 'Seattle',
        assignedLocations: access === 'all' ? ['*'] : access === 'branches' ? ['Seattle', 'Dallas'] : ['Seattle'],
        permissions: ['view_dashboard', 'view_customers', ...(access === 'all' ? ['view_all_visits'] : access === 'branches' ? ['view_branch_visits'] : []), 'view_team_calendar'] };
    const people = [
        { ...user, _id: 'u1', displayName: 'Alex Stone' },
        { _id: 'sea', username: 'sree', displayName: 'Sree', role: 'sales_rep', location: 'Seattle', assignedLocations: ['Seattle'] },
        { _id: 'dal', username: 'asha', displayName: 'Asha', role: 'sales_rep', location: 'Dallas', assignedLocations: ['Dallas'] },
        { _id: 'atl', username: 'jon', displayName: 'Jon', role: 'sales_rep', location: 'Atlanta', assignedLocations: ['Atlanta'] },
        { _id: 'cross', username: 'hemanth', displayName: 'Hemanth', role: 'sales_rep', location: 'Dallas', assignedLocations: ['Dallas', 'Seattle'] }
    ];
    const visits = people.map(person => ({
        _id: `v-${person._id}`, customerId: `c-${person._id}`, company: `${person.displayName} Account`, customerName: `${person.displayName} Account`,
        contactName: 'Test Contact', location: person.location === 'Seattle' ? 'Atlanta' : 'Seattle',
        createdBy: person._id, createdByName: person.displayName, date: '2026-11-05', purpose: 'Sales Call',
        notes: `${person.displayName} visit`, followUp: 'Call back', followUpDate: '2026-11-06'
    }));
    let liveSocket: WebSocketRoute | undefined;
    await page.routeWebSocket('**/socket.io/**', socket => {
        liveSocket = socket;
        socket.send('0' + JSON.stringify({ sid: 'dashboard-browser', upgrades: [], pingInterval: 25000, pingTimeout: 20000 }));
        socket.onMessage(message => {
            if (String(message).startsWith('40')) socket.send('40' + JSON.stringify({ sid: 'dashboard-browser' }));
            if (String(message) === '2') socket.send('3');
        });
    });
    await page.route('**/api/user/me', route => route.fulfill({ json: user }));
    await page.route('**/api/salesreps', route => route.fulfill({ json: { data: people } }));
    await page.route('**/api/admin/locations', route => route.fulfill({ json: ['Seattle', 'Dallas', 'Atlanta'].map(name => ({ name })) }));
    const selected = (url: URL) => {
        const ids = narrowPeople(visiblePeople(user, people), { reps: (url.searchParams.get('reps') || '').split(',').filter(Boolean), location: url.searchParams.get('location') || '' }, people);
        return visits.filter(visit => ids === '*' || ids.has(visit.createdBy));
    };
    await page.route('**/api/dashboard/**', route => {
        const url = new URL(route.request().url());
        const rows = selected(url);
        const counts = { all: rows.length, pending: rows.length, done: 0, overdue: 0, today: 0, upcoming: rows.length, noDate: 0 };
        const resources = rows.map(row => ({ ...row, _id: `r-${row._id}`, title: `${row.createdByName} Samples`, description: `${row.createdByName} resources`, resourceType: 'Samples', qty: 1, uploadedBy: row.createdBy, uploadedByName: row.createdByName }));
        if (url.pathname.endsWith('/stats')) return route.fulfill({ json: { visits: rows.length, resources: rows.length, followUp: rows.length, followUpCounts: counts } });
        if (url.pathname.endsWith('/followups/panel')) return route.fulfill({ json: [] });
        if (url.pathname.endsWith('/followups')) return route.fulfill({ json: { rows, summary: counts, counts, doneThisWeek: 0 } });
        if (url.pathname.endsWith('/resources')) return route.fulfill({ json: resources });
        return route.fulfill({ json: rows });
    });
    return { visits, announce: () => { if (!liveSocket) throw new Error('Dashboard socket did not connect'); liveSocket.send('42["customer_update"]'); } };
}

const openFilters = async (page: Page) => { await page.getByRole('button', { name: /^Filters/ }).click(); };
const pickTeam = async (page: Page) => {
    await page.getByRole('button', { name: 'People', exact: true }).click();
    await page.getByRole('checkbox', { name: 'My team', exact: true }).click();
    await page.getByRole('checkbox', { name: 'My team', exact: true }).press('Escape');
};
const location = async (page: Page, name: string) => {
    await page.getByLabel('Location', { exact: true }).click();
    await page.getByRole('option', { name, exact: true }).click();
};

test('global dashboard combines branches, drills into reps, and receives another rep’s live work', async ({ page }) => {
    const fixture = await dashboardFixture(page, 'all');
    await page.goto('/sales?tab=dashboard');
    const list = page.getByRole('list', { name: 'Sales visits', exact: true });
    await expect(list).toContainText('Alex Stone Account');
    await openFilters(page);
    await pickTeam(page);
    await location(page, 'All locations');
    await page.getByRole('button', { name: 'Close filters', exact: true }).click();
    await expect(list.locator(':scope > li')).toHaveCount(5);
    await expect(page.locator('.dfx-card').filter({ hasText: 'VISITS' }).locator('.dfx-card-value')).toHaveText('5');
    await openFilters(page);
    await page.getByRole('button', { name: 'By rep', exact: true }).click();
    await page.getByRole('button', { name: 'Close filters', exact: true }).click();
    const breakdown = page.locator('.drb-table');
    await expect(breakdown.locator('tfoot')).toContainText('5');
    await breakdown.getByRole('button', { name: 'Asha', exact: true }).click();
    await expect(list.locator(':scope > li')).toHaveCount(1);
    await expect(list).toContainText('Asha Account');
    await expect(page.locator('.dashboard-people-summary')).toContainText('Asha');

    fixture.visits.push({ ...fixture.visits.find(visit => visit.createdBy === 'dal')!, _id: 'v-live', company: 'Live Dallas Account', customerName: 'Live Dallas Account' });
    fixture.announce();
    await expect(list.locator(':scope > li')).toHaveCount(2);
    await expect(list).toContainText('Live Dallas Account');
    await expect(page.locator('.dfx-card').filter({ hasText: 'VISITS' }).locator('.dfx-card-value')).toHaveText('2');

    await page.locator('.dfx-card').filter({ hasText: 'RESOURCES' }).click();
    await expect(page.getByRole('heading', { name: 'Resources', exact: true })).toBeVisible();
    await expect(page.locator('.rs-panel')).toContainText('Asha');
    await expect(page.locator('.rs-panel')).not.toContainText('Sree');
    await page.locator('.dfx-card').filter({ hasText: 'FOLLOW-UP' }).click();
    await expect(page.getByRole('heading', { name: 'Follow-ups', exact: true })).toBeVisible();
    await expect(page.locator('.fu-panel')).toContainText('Asha Account');
    await expect(page.locator('.fu-panel')).not.toContainText('Sree Account');
});

test('multi-location manager is offered only their branches and reps', async ({ page }) => {
    await dashboardFixture(page, 'branches');
    await page.goto('/sales?tab=dashboard');
    await expect(page.getByRole('list', { name: 'Sales visits', exact: true })).toContainText('Alex Stone Account');
    await openFilters(page);
    await page.getByRole('button', { name: 'People', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Asha', exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Jon', exact: true })).toHaveCount(0);
    await page.getByRole('checkbox', { name: 'My team', exact: true }).click();
    await page.getByRole('checkbox', { name: 'My team', exact: true }).press('Escape');
    await page.getByLabel('Location', { exact: true }).click();
    await expect(page.getByRole('option', { name: 'Atlanta', exact: true })).toHaveCount(0);
    await page.getByRole('option', { name: 'Dallas', exact: true }).click();
    await page.getByRole('button', { name: 'Close filters', exact: true }).click();
    const list = page.getByRole('list', { name: 'Sales visits', exact: true });
    // The manager is assigned to Dallas too, so their work belongs here.
    await expect(list.locator(':scope > li')).toHaveCount(3);
    await expect(list).toContainText('Alex Stone Account');
    await expect(list).toContainText('Asha Account');
    await expect(list).toContainText('Hemanth Account');
    await expect(list).not.toContainText('Jon Account');
});

test('own-only rep sees their work with no team or location selector', async ({ page }) => {
    await dashboardFixture(page, 'own');
    await page.goto('/sales?tab=dashboard');
    const list = page.getByRole('list', { name: 'Sales visits', exact: true });
    await expect(list.locator(':scope > li')).toHaveCount(1);
    await expect(list).toContainText('Alex Stone Account');
    await expect(list).not.toContainText('Asha Account');
    await openFilters(page);
    await expect(page.getByLabel('People', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Location', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'By rep', exact: true })).toHaveCount(0);
});
