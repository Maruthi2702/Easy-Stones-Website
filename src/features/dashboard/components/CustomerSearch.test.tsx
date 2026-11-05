// @vitest-environment jsdom
// Dashboard → Find a customer (CustomerSearch): recent list, typing, keys, picking.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { toCustomerOptions } from '../../../utils/customerOptions';
import { recentKey } from '../../../utils/customerQuickSearch';

const state = vi.hoisted(() => ({ options: [] as unknown[], loading: false, refresh: () => {} }));
vi.mock('../../../api/customerOptions', () => ({ useCustomerOptions: () => ({ records: [], ...state }) }));

import CustomerSearch from './CustomerSearch';

const OPTIONS = toCustomerOptions([
    { _id: '1', company: 'Harbor Stone Works', contactName: 'Mike Tran', city: 'Seattle', customerType: 'Fabricator', salesRepName: 'Jamie Park' },
    { _id: '2', company: 'Cascade Surfaces', contactName: 'Tom Harper', city: 'Kent' },
    { _id: '3', company: 'Sound Kitchens', city: 'Tacoma' }
]);

beforeEach(() => {
    state.options = OPTIONS;
    state.loading = false;
    localStorage.clear();
});
afterEach(cleanup);

const box = () => screen.getByRole('combobox', { name: 'Search customers' });
const names = () => screen.queryAllByRole('option').map((o) => o.querySelector('.dcs-name')?.textContent);

describe('Find a customer', () => {
    it('opens on the recently opened customers, with the box focused', () => {
        localStorage.setItem(recentKey('u1'), JSON.stringify(['3', '1']));
        render(<CustomerSearch userId="u1" onClose={() => {}} onPick={() => {}} />);
        expect(document.activeElement).toBe(box());
        expect(screen.getByText('Recently opened')).toBeTruthy();
        expect(names()).toEqual(['Sound Kitchens', 'Harbor Stone Works']);
    });

    it('typing narrows the list; ↓ and Enter open the highlighted one and remember it', () => {
        const onPick = vi.fn();
        render(<CustomerSearch userId="u1" onClose={() => {}} onPick={onPick} />);
        fireEvent.change(box(), { target: { value: 'har' } });
        expect(names()).toEqual(['Harbor Stone Works', 'Cascade Surfaces']);
        expect(screen.getByText('2 found')).toBeTruthy();
        fireEvent.keyDown(box(), { key: 'ArrowDown' });
        fireEvent.keyDown(box(), { key: 'Enter' });
        expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ value: '2', label: 'Cascade Surfaces' }));
        expect(JSON.parse(localStorage.getItem(recentKey('u1')) || '[]')).toEqual(['2']);
    });

    it('a click opens that customer', () => {
        const onPick = vi.fn();
        render(<CustomerSearch userId="u1" onClose={() => {}} onPick={onPick} />);
        fireEvent.change(box(), { target: { value: 'sound' } });
        fireEvent.click(screen.getByRole('option'));
        expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ value: '3' }));
    });

    it('nothing matches: says so, and offers Add customer only when given', () => {
        const onAdd = vi.fn();
        const { rerender } = render(<CustomerSearch userId="u1" onClose={() => {}} onPick={() => {}} />);
        fireEvent.change(box(), { target: { value: 'quartzline' } });
        expect(screen.getByText('No customer matches “quartzline”')).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Add customer/ })).toBeNull();
        rerender(<CustomerSearch userId="u1" onClose={() => {}} onPick={() => {}} onAddCustomer={onAdd} />);
        fireEvent.click(screen.getByRole('button', { name: /Add customer/ }));
        expect(onAdd).toHaveBeenCalledWith('quartzline');
    });

    it('Esc, Cancel and the dark page around it close it', () => {
        const onClose = vi.fn();
        render(<CustomerSearch userId="u1" onClose={onClose} onPick={() => {}} />);
        fireEvent.keyDown(document, { key: 'Escape' });
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        fireEvent.click(screen.getByRole('button', { name: 'Close search' }));
        expect(onClose).toHaveBeenCalledTimes(3);
    });

    it('while the list loads it says so; a list that never came offers Try again', () => {
        state.options = [];
        state.loading = true;
        const { rerender } = render(<CustomerSearch userId="u1" onClose={() => {}} onPick={() => {}} />);
        expect(screen.getByText('Loading customers…')).toBeTruthy();
        state.loading = false;
        rerender(<CustomerSearch userId="u1" onClose={() => {}} onPick={() => {}} />);
        expect(screen.getByText('Couldn’t load the customer list')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    });
});
