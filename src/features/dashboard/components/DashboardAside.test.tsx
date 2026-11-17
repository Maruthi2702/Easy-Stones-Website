// @vitest-environment jsdom
// The Visits tab's Today panel: the Calendar's timeline in small, and a stop's ⋯ menu.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import DashboardAside from './DashboardAside';

const at = (h: number, m: number) => { const d = new Date(); d.setHours(h, m, 0, 0); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000`; };
const schedules = [
    { _id: 's1', customerId: { _id: 'c1', company: 'Pacific Granite' }, startTime: at(9, 0), activityType: 'Visit', status: 'Scheduled' },
    { _id: 's2', customerId: { _id: 'c2', company: 'Stone River' }, startTime: at(23, 30), activityType: 'Call', status: 'Scheduled' }
];
const props = (o = {}) => ({
    schedules, customerName: (s: any) => s.customerId.company, followUps: [], followUpCount: 0,
    onOpenPlanner: vi.fn(), onOpenFollowUps: vi.fn(), onOpenCustomerById: vi.fn(), ...o
});
afterEach(cleanup);

describe('Visits → Today panel', () => {
    it('is a timeline with a NOW line and a ⋯ per stop', () => {
        render(<DashboardAside {...props()} />);
        expect(screen.getAllByLabelText(/^More for/)).toHaveLength(2);
        expect(document.querySelector('.dfx-stops--timeline .dfx-now')).not.toBeNull();
        expect(document.querySelectorAll('.dfx-stop-dot')).toHaveLength(2);
    });

    it('offers Directions, Open profile and Edit in Calendar, and they do what they say', () => {
        const p = props();
        render(<DashboardAside {...p} />);
        fireEvent.click(screen.getAllByLabelText(/^More for/)[0]);
        expect(screen.getAllByRole('menuitem').map((i) => i.textContent?.trim())).toEqual(['Directions', 'Open profile', 'Edit in Calendar']);
        fireEvent.click(screen.getByRole('menuitem', { name: /Open profile/ }));
        expect(p.onOpenCustomerById).toHaveBeenCalledWith('c1');
        fireEvent.click(screen.getAllByLabelText(/^More for/)[0]);
        fireEvent.click(screen.getByRole('menuitem', { name: /Edit in Calendar/ }));
        expect(p.onOpenPlanner).toHaveBeenCalled();
    });
});
