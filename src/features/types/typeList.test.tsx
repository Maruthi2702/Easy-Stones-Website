// @vitest-environment jsdom
// Render smoke test for Admin → Visit Types / Resource Types (TypeListTab.tsx).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

const types = [
    { _id: 'a', name: 'Quick Note', label: 'Quick note', order: 0, active: true, system: true, fields: { notes: true, outcome: false, followUp: 'none' } },
    { _id: 'b', name: 'Site Walk', label: 'Site walk', order: 1, active: false, system: false, fields: { notes: true, outcome: true, followUp: 'optional' } },
    { _id: 'c', name: 'Formal Presentation', label: 'Formal presentation', order: 2, active: true, system: true, fields: { notes: true, outcome: true, followUp: 'always' } }
];

const calls: { url: string; method: string; body?: unknown }[] = [];
vi.mock('../../api/authFetch', () => ({
    authFetch: vi.fn(async (url: string, init: { method?: string; body?: string } = {}) => {
        calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined });
        if (init.method === 'PATCH') {
            const ids: string[] = JSON.parse(init.body as string).ids;
            return { ok: true, json: async () => ({ types: ids.map((id, order) => ({ ...types.find((t) => t._id === id), order })) }) };
        }
        return { ok: true, json: async () => ({ types }) };
    })
}));

const { default: TypeListTab } = await import('./TypeListTab');
const { clearTypeLists } = await import('../../api/typeLists');

const manager = { permissions: ['reorder_visit_types', 'edit_visit_types', 'add_visit_types'] };

beforeEach(() => { calls.length = 0; clearTypeLists(); });
afterEach(cleanup);

describe('TypeListTab', () => {
    it('lists the types from the database in order, hidden ones marked', async () => {
        render(<TypeListTab kind="visit" currentUser={manager} />);
        await waitFor(() => expect(screen.getByText('Quick note')).toBeTruthy());
        const rows = screen.getAllByRole('listitem').map((li) => li.textContent);
        expect(rows[0]).toContain('Quick note');
        expect(rows[1]).toContain('Site walk');
        expect(rows[1]).toContain('Hidden');
        expect(rows[0]).toContain('Built in');
        expect(screen.getByRole('button', { name: /Add/ })).toBeTruthy();
    });

    it('Move to top saves the whole list in the new order', async () => {
        render(<TypeListTab kind="visit" currentUser={manager} />);
        await waitFor(() => expect(screen.getByText('Formal presentation')).toBeTruthy());
        fireEvent.click(screen.getByRole('button', { name: 'Move Formal presentation to the top' }));
        await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
        expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ ids: ['c', 'a', 'b'] });
        expect(screen.getAllByRole('listitem')[0].textContent).toContain('Formal presentation');
    });

    it('someone without the actions sees the list and no controls', async () => {
        render(<TypeListTab kind="visit" currentUser={{ permissions: ['add_visit_types'] }} />);
        await waitFor(() => expect(screen.getByText('Quick note')).toBeTruthy());
        expect(screen.queryByRole('button', { name: /to the top/ })).toBeNull();
        expect(screen.getByRole('button', { name: /Add/ })).toBeTruthy();
    });
});
