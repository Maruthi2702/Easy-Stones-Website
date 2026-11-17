// @vitest-environment jsdom
// The planner on a phone (under 640px): Day and Month only, no arrows or Today, the date is the
// button that opens the calendar, and the Month view is a number and a count per day, a tap opens it.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

const iso = (offset: number, hm: string) => {
    const d = new Date(); d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${hm}:00.000`;
};
const stops = [
    { _id: 's1', customerId: { _id: 'c1', company: 'Pacific Granite' }, startTime: iso(0, '09:00'), activityType: 'Visit', status: 'Scheduled' },
    { _id: 's2', customerId: { _id: 'c2', company: 'Stone River' }, startTime: iso(0, '11:00'), activityType: 'Call', status: 'Scheduled' }
];
vi.mock('../../api/authFetch', () => ({
    authFetch: () => Promise.resolve(new Response(JSON.stringify(stops), { status: 200, headers: { 'Content-Type': 'application/json' } })),
    resetSessionExpiredGuard() {}
}));
vi.mock('socket.io-client', () => ({ io: () => ({ on() { return this; }, off() { return this; }, emit() { return this; }, disconnect() {}, connected: false }) }));
const { SalesPlannerTab } = await import('./index');

const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); };
const original = window.matchMedia;
beforeEach(() => {
    window.matchMedia = ((query: string) => ({
        matches: query.includes('max-width: 639px'), media: query, onchange: null,
        addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false
    })) as unknown as typeof window.matchMedia;
});
afterEach(() => { cleanup(); window.matchMedia = original; });

const mount = async () => { render(<SalesPlannerTab customerOptions={[]} currentUserId="u1" />); await settle(); };
const labels = () => [...document.querySelectorAll('.pl-views button')].map((b) => b.textContent);

describe('Sales Planner on a phone', () => {
    it('has Day and Month only, no arrows, no Today button and no week strip', async () => {
        await mount();
        expect(labels()).toEqual(['Day', 'Month']);
        expect(screen.queryByLabelText('Previous')).toBeNull();
        expect(screen.queryByLabelText('Next')).toBeNull();
        expect(document.querySelector('.pl-today:not(.pl-optimize)')).toBeNull();
        expect(document.querySelector('.pl-week-strip')).toBeNull();
        // The date is the button that opens the calendar.
        expect(document.querySelector('.pl-title-wrap .pl-title')).not.toBeNull();
    });

    it('shows the month as a count per day and opens a day when it is tapped', async () => {
        await mount();
        fireEvent.click([...document.querySelectorAll('.pl-views button')].find((b) => b.textContent === 'Month') as Element);
        await settle();
        expect(document.querySelectorAll('.pl-pcell').length).toBeGreaterThanOrEqual(28);
        expect(screen.getByText('2 stops this month')).toBeTruthy();
        const todayCell = document.querySelector('.pl-pcell.is-today') as HTMLElement;
        expect(todayCell.querySelector('.pl-pcount')?.textContent).toBe('2');
        fireEvent.click(todayCell);
        await settle();
        // Back in the Day view, on that day, with its stops.
        expect(labels()?.length).toBe(2);
        expect(document.querySelector('.pl-pcell')).toBeNull();
        expect(screen.getByText('Pacific Granite')).toBeTruthy();
    });
});
