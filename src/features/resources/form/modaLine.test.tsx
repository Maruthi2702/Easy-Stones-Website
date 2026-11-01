// @vitest-environment jsdom
// Render smoke test for the Moda counts on screen (src/utils/modaTotals.ts): the
// Add resource form's Qty label and change line, and the drawer's tiles.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

const types = [
    { _id: 't', name: '2025V3 Moda Tower', label: '2025V3 Moda Tower', order: 0, active: true, system: false, family: 'tower' },
    { _id: 'b', name: 'Binder NW', label: 'Moda Sample Binder NorthWest V1 12', order: 1, active: true, system: false, family: 'binder' },
    { _id: 's', name: 'Misc Samples', label: 'Moda Misc. Samples', order: 2, active: true, system: false, family: 'samples' }
];
const summary = {
    display: true, binders: 9, earlier: { display: false, binders: 6 },
    items: [
        { _id: 'r2', type: 'Binder NW', qty: 3, date: '2026-11-01', status: 'Active', kind: 'binders' },
        { _id: 'r1', type: '2025V3 Moda Tower', qty: 1, date: '2026-10-30', status: 'Active', kind: 'display' }
    ]
};

vi.mock('../../../api/authFetch', () => ({
    authFetch: vi.fn(async (url: string) => ({
        ok: true,
        json: async () => (url.endsWith('/moda') ? summary : { types })
    }))
}));

const { default: ResourceForm } = await import('./ResourceForm');
const { default: ModaTiles } = await import('../../customers/list/ModaTiles');
const { clearTypeLists } = await import('../../../api/typeLists');

const base = { customerId: 'c1', resourceType: '', qty: '1', date: '2026-11-01', status: 'Active', description: '', notes: '' };
const form = (values: Partial<typeof base>) => (
    <ResourceForm
        isEdit={false}
        values={{ ...base, ...values }}
        initial={base}
        onChange={() => {}}
        attachments={[]}
        initialAttachmentCount={0}
        onUpload={() => {}}
        onRemoveAttachment={() => {}}
        customerOptions={[{ value: 'c1', label: 'Five Star Granite, Inc.' }]}
        saving={false}
        onSave={() => {}}
        onClose={() => {}}
    />
);

beforeEach(() => { clearTypeLists(); });
afterEach(cleanup);

describe('Add resource: Moda', () => {
    it('a binder type reads "Binders" and shows the new total', async () => {
        render(form({ resourceType: 'Binder NW', qty: '2' }));
        await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Binders 9 → 11 (+2)'));
        expect(screen.getByText('Binders', { selector: 'label, label *' })).toBeTruthy();
    });
    it('a tower when Display is already Installed changes nothing, so no line', async () => {
        render(form({ resourceType: '2025V3 Moda Tower' }));
        await waitFor(() => expect(screen.getByText('Towers', { selector: 'label, label *' })).toBeTruthy());
        expect(screen.queryByRole('status')).toBeNull();
    });
    it('other types keep "Qty" and no line', async () => {
        render(form({ resourceType: 'Misc Samples', qty: '4' }));
        await waitFor(() => expect(screen.getByText('Qty', { selector: 'label, label *' })).toBeTruthy());
        expect(screen.queryByRole('status')).toBeNull();
    });
});

describe('Moda Resources tiles', () => {
    it('shows the counted totals, the tower behind Display, and the binder breakdown on click', async () => {
        render(<ModaTiles customer={{ _id: 'c1', modaDisplay: 'No', modaBinder: '6' }} />);
        await waitFor(() => expect(screen.getByText('9')).toBeTruthy());
        expect(screen.getByText('Installed')).toBeTruthy();
        expect(screen.getByText(/2025V3 Moda Tower ·/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /3 added/ }));
        expect(screen.getByText('Counted before resources were logged')).toBeTruthy();
        expect(screen.getByText('Total binders')).toBeTruthy();
        expect(screen.getByText(/Moda Sample Binder NorthWest V1 12 ·/)).toBeTruthy();
    });
});
