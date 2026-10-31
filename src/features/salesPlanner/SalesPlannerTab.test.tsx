// @vitest-environment jsdom
// Sales Planner render: the week (weekday columns and the weekend rail), the
// Day and Month views, "+N more", the add / edit form (the shared schedule form) and its check, the
// delete check, a save and a delete reaching the API, a keyboard pick-up, and a
// refused load. The API is a fake keyed on the URL; the socket is a stand-in.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

const iso = (offset: number, hm: string) => {
    const d = new Date(); d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${hm}:00.000`;
};
const today = [
    { _id: 's1', customerId: { _id: 'c1', company: 'Pacific Granite' }, startTime: iso(0, '09:00'), activityType: 'Visit', status: 'Scheduled', notes: 'Bring the Moda binder' },
    { _id: 's2', customerId: { _id: 'c2', company: 'Stone River' }, startTime: iso(0, '11:00'), activityType: 'Call', status: 'Completed' },
    { _id: 's3', customerId: { _id: 'c3', company: 'Kent Marble' }, startTime: iso(0, '13:00'), activityType: 'Drop-off', status: 'Scheduled' },
    { _id: 's4', customerId: 'c4', startTime: iso(0, '15:00'), activityType: 'Other', status: 'Scheduled' }
];
let schedule: unknown[] = today;
let refuse = false;
const calls: { url: string; method: string; body?: string }[] = [];
const answer = (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body as string | undefined });
    if (refuse) return Promise.resolve(new Response('{}', { status: 500 }));
    const body = (init.method || 'GET') === 'GET' ? schedule : { ok: true };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
};
vi.mock('../../api/authFetch', () => ({ authFetch: (u: string, init?: RequestInit) => answer(u, init), resetSessionExpiredGuard() {} }));
vi.mock('socket.io-client', () => ({ io: () => ({ on() { return this; }, off() { return this; }, emit() { return this; }, disconnect() {}, connected: false }) }));

const { SalesPlannerTab } = await import('./index');

const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); };
const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLElement;
const view = async (label: string) => { fireEvent.click(button(label)); await settle(); };
const next = async () => { fireEvent.click(screen.getByLabelText('Next')); await settle(); };
const options = [{ value: 'c1', label: 'Pacific Granite' }, { value: 'c2', label: 'Stone River' }];

async function open(props: Record<string, unknown> = {}) {
    render(<SalesPlannerTab customerOptions={options} currentUserId="u1" {...props} />);
    await settle();
    await view('Today');
}

beforeEach(() => { schedule = today; refuse = false; calls.length = 0; });
afterEach(async () => { await view('Week'); cleanup(); });

describe('Sales Planner', () => {
    it('shows the week: five columns, the weekend rail, today\'s stops and the legend', async () => {
        await open();
        await view('Week');
        expect(document.querySelectorAll('.pl-col')).toHaveLength(5);
        expect(document.querySelector('.pl-rail')).not.toBeNull();
        expect(screen.getByText('Pacific Granite')).toBeTruthy();
        expect(screen.getByText('Bring the Moda binder')).toBeTruthy();
        expect(screen.getByText('4 stops today')).toBeTruthy();
        expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0);
        expect(document.querySelector('.pl-legend')?.textContent).toBe('VisitCallDrop-offOther');
        expect(calls[0].url).toMatch(/\/api\/schedule\?start=\d{4}-\d{2}-\d{2}T00:00:00\.000&end=\d{4}-\d{2}-\d{2}T23:59:59\.999$/);
    });

    it('switches to Day and Month; "+1 more" opens the day', async () => {
        await open();
        await view('Day');
        expect(document.querySelector('.pl-grid--day')).not.toBeNull();
        await view('Month');
        expect(document.querySelector('.pl-month')).not.toBeNull();
        expect(document.querySelectorAll('.pl-mrow').length).toBeGreaterThanOrEqual(4);
        fireEvent.click(button('+1 more'));
        await settle();
        expect(document.querySelector('.pl-grid--day')).not.toBeNull();
        expect(document.querySelectorAll('.pl-col .pl-item')).toHaveLength(4);
    });

    it('an empty week offers "Add a stop" on every weekday', async () => {
        schedule = [];
        await open();
        await next();
        expect(screen.getAllByText('Add a stop')).toHaveLength(5);
    });

    it('adds a stop: the form opens on the day, asks for a customer, then saves', async () => {
        const onScheduleChange = vi.fn();
        await open({ onScheduleChange });
        fireEvent.click(document.querySelectorAll('.pl-addday')[0]);
        await settle();
        expect(screen.getByText('Schedule activity')).toBeTruthy();
        fireEvent.click(document.querySelector('.fm-btn-primary') as Element);
        await settle();
        expect(screen.getAllByText('Pick a customer').length).toBeGreaterThan(0);
        expect(calls.find((c) => c.method === 'POST')).toBeUndefined();

        fireEvent.click(document.getElementById('sa-customer') as Element);
        await settle();
        fireEvent.click([...document.querySelectorAll('.fm-opt')].find((o) => o.textContent?.includes('Stone River')) as Element);
        fireEvent.click(document.querySelector('.fm-btn-primary') as Element);
        await settle();
        const post = calls.find((c) => c.method === 'POST');
        expect(post?.url).toMatch(/\/api\/schedule$/);
        // A type, a start and an end (30 minutes by default), and its own id so a repeat books once.
        const sent = JSON.parse(post!.body!);
        expect(sent).toMatchObject({ customerId: 'c2', activityType: 'Visit', notes: '' });
        expect(sent._id).toMatch(/^[a-f0-9]{24}$/);
        expect(new Date(sent.endTime).getTime() - new Date(sent.startTime).getTime()).toBe(30 * 60000);
        expect(onScheduleChange).toHaveBeenCalled();
        expect(screen.queryByText('Schedule activity')).toBeNull();
    });

    it('opens a day that has a 9:00 stop on the next free start, not on top of it', async () => {
        await open();
        fireEvent.click(document.querySelectorAll('.pl-addday')[0]);
        await settle();
        const text = document.querySelector('.fm-dialog')?.textContent || '';
        expect(text).toContain('Already on');
        expect(text).toContain('This visit');
    });

    it('edits a stop and saves it with PUT', async () => {
        await open();
        fireEvent.click(screen.getAllByLabelText('Edit activity')[0]);
        await settle();
        expect(screen.getByText('Edit activity')).toBeTruthy();
        expect((document.querySelector('.fm-dialog textarea') as HTMLTextAreaElement).value).toBe('Bring the Moda binder');
        fireEvent.click(document.querySelector('.fm-btn-primary') as Element);
        await settle();
        const put = calls.find((c) => c.method === 'PUT');
        expect(put?.url).toMatch(/\/api\/schedule\/s1$/);
        expect(JSON.parse(put!.body!)).toMatchObject({ customerId: 'c1', activityType: 'Visit', notes: 'Bring the Moda binder' });
    });

    it('asks before deleting, and Escape closes the check', async () => {
        await open();
        fireEvent.click(screen.getAllByLabelText('Delete activity')[0]);
        await settle();
        expect(screen.getByText('Delete this scheduled activity?')).toBeTruthy();
        fireEvent.keyDown(document, { key: 'Escape' });
        await settle();
        expect(screen.queryByText('Delete this scheduled activity?')).toBeNull();

        fireEvent.click(screen.getAllByLabelText('Delete activity')[0]);
        await settle();
        fireEvent.click(document.querySelector('.pl-danger-btn') as Element);
        await settle();
        expect(calls.find((c) => c.method === 'DELETE')?.url).toMatch(/\/api\/schedule\/s1$/);
        expect(screen.queryByText('Delete this scheduled activity?')).toBeNull();
    });

    it('picks a stop up with Space and puts it down with Escape', async () => {
        await open();
        const card = document.querySelector('[data-planner-card="s1"]') as HTMLElement;
        fireEvent.keyDown(card, { key: ' ' });
        await settle();
        expect(document.querySelector('[data-planner-card="s1"]')?.className).toContain('is-grabbed');
        expect(document.querySelector('.pl-live')?.textContent).toContain('Pacific Granite picked up.');
        fireEvent.keyDown(document, { key: 'Escape' });
        await settle();
        expect(document.querySelector('.pl-live')?.textContent).toBe('Pacific Granite left where it was.');
        expect(document.querySelector('.is-grabbed')).toBeNull();
    });

    it('a refused load with nothing cached says so, with Try again', async () => {
        refuse = true;
        await open();
        // A span no earlier case has loaded, so nothing is cached for it.
        await view('Month');
        for (let i = 0; i < 6; i++) await next();
        expect(screen.getByRole('alert').textContent).toContain('Could not load the schedule.');
        expect(button('Try again')).toBeTruthy();
        refuse = false;
        await view('Today');
    });
});

describe('Sales Planner — the team calendar (teamScope.js)', () => {
    const team = [
        { _id: 't1', userId: 'u1', ownerName: 'Krish', customerId: { _id: 'c1', company: 'Pacific Granite' }, startTime: iso(0, '09:00'), activityType: 'Visit', status: 'Scheduled' },
        { _id: 't2', userId: 'u2', ownerName: 'Jesus B.', customerId: { _id: 'c2', company: 'Stone River' }, startTime: iso(0, '10:00'), activityType: 'Call', status: 'Scheduled' }
    ];
    const card = (name: string) => screen.getByText(name).closest('.pl-item') as HTMLElement;

    it("asks for the team, names whose each stop is, and leaves others' read only", async () => {
        schedule = team;
        await open({ viewing: '&scope=team', includesMe: true, justMe: false });
        expect(calls[0].url).toMatch(/&scope=team$/);
        expect(card('Stone River').textContent).toContain('Jesus B.');
        expect(card('Stone River').querySelector('[aria-label="Edit activity"]')).toBeNull();
        expect(card('Pacific Granite').querySelector('[aria-label="Edit activity"]')).not.toBeNull();
        // Moving needs your calendar alone.
        expect(card('Pacific Granite').getAttribute('draggable')).toBeNull();
        expect(screen.getByLabelText('Schedule activity')).toBeTruthy();
    });

    it("offers no Add on a calendar you aren't in", async () => {
        schedule = [team[1]];
        await open({ viewing: '&scope=team&reps=u2', includesMe: false, justMe: false });
        expect(screen.queryByLabelText('Schedule activity')).toBeNull();
        expect(document.querySelector('.pl-addday')).toBeNull();
    });

    it('is your own, movable calendar as before without it', async () => {
        await open();
        expect(card('Pacific Granite').getAttribute('draggable')).toBe('true');
        expect(card('Pacific Granite').textContent).not.toContain('Krish');
    });
});
