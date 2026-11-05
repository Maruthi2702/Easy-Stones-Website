// @vitest-environment jsdom
// Find a customer's two looks: the header field on a laptop / desktop, the pop-up on an iPad / phone.
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { toCustomerOptions } from '../../../utils/customerOptions';

const state = vi.hoisted(() => ({ options: [] as unknown[], loading: false, refresh: () => {} }));
vi.mock('../../../api/customerOptions', () => ({ useCustomerOptions: () => ({ records: [], ...state }) }));

import CustomerFinder, { HEADER_FIELD_QUERY } from './CustomerFinder';

const OPTIONS = toCustomerOptions([
    { _id: '1', company: 'Harbor Stone Works', contactName: 'Mike Tran', city: 'Seattle' },
    { _id: '2', company: 'Cascade Surfaces', contactName: 'Tom Harper', city: 'Kent' }
]);

// A screen: true = 1024px+ with a mouse (laptop / desktop), false = iPad or phone.
const screenIs = (laptop: boolean) => {
    window.matchMedia = ((query: string) => ({
        matches: query === HEADER_FIELD_QUERY ? laptop : false,
        media: query, addEventListener: () => {}, removeEventListener: () => {}
    })) as unknown as typeof window.matchMedia;
};

function Harness({ onPick = () => {} }: { onPick?: (c: unknown) => void }) {
    const [open, setOpen] = useState(false);
    return (
        <div className="dfx-head">
            <div className="dfx-head-range">range</div>
            <CustomerFinder open={open} onOpen={() => setOpen(true)} onClose={() => setOpen(false)} userId="u1" onPick={(c) => { setOpen(false); onPick(c); }} />
        </div>
    );
}

beforeEach(() => {
    state.options = OPTIONS;
    localStorage.clear();
});
afterEach(cleanup);

const button = () => screen.getByRole('button', { name: 'Find a customer' });
const box = () => screen.getByRole('combobox', { name: 'Search customers' });

describe('Find a customer — laptop / desktop: the header field', () => {
    beforeEach(() => screenIs(true));

    it('the 🔍 becomes the field in the header, focused, with no pop-up over the page', () => {
        render(<Harness />);
        fireEvent.click(button());
        expect(screen.queryByRole('button', { name: 'Find a customer' })).toBeNull();
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(document.activeElement).toBe(box());
        expect(document.querySelector('.dfx-find.is-open')).toBeTruthy();
    });

    it('typing lists the matches under it; Enter opens one and it closes back to the 🔍', () => {
        const onPick = vi.fn();
        render(<Harness onPick={onPick} />);
        fireEvent.click(button());
        fireEvent.change(box(), { target: { value: 'har' } });
        expect(screen.getAllByRole('option')).toHaveLength(2);
        fireEvent.keyDown(box(), { key: 'Enter' });
        expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ value: '1' }));
        expect(button()).toBeTruthy();
    });

    it('a click elsewhere: empty → back to the 🔍; with text → only the list hides', () => {
        render(<Harness />);
        fireEvent.click(button());
        fireEvent.change(box(), { target: { value: 'har' } });
        fireEvent.pointerDown(document.body);
        expect(box()).toBeTruthy();
        expect(screen.queryAllByRole('option')).toHaveLength(0);
        fireEvent.focus(box());
        expect(screen.getAllByRole('option')).toHaveLength(2);

        fireEvent.change(box(), { target: { value: '' } });
        fireEvent.pointerDown(document.body);
        expect(button()).toBeTruthy();
    });

    it('Esc closes it', () => {
        render(<Harness />);
        fireEvent.click(button());
        fireEvent.keyDown(box(), { key: 'Escape' });
        expect(button()).toBeTruthy();
    });
});

describe('Find a customer — iPad / phone: the pop-up', () => {
    beforeEach(() => screenIs(false));

    it('the 🔍 opens the pop-up (the full-screen sheet on a phone) and keeps its place', () => {
        render(<Harness />);
        fireEvent.click(button());
        expect(screen.getByRole('dialog', { name: 'Find a customer' })).toBeTruthy();
        expect(document.querySelector('.dfx-find')).toBeNull();
        expect(button()).toBeTruthy();
    });
});
