// @vitest-environment jsdom
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import CustomersView from './CustomersView';
import type { CustomersViewProps } from './CustomersView';
import FormModal from '../../components/shared/form/FormModal';

const lifecycle = vi.hoisted(() => ({ initialize: vi.fn(), connect: vi.fn(), disconnect: vi.fn() }));
vi.mock('../customers', () => ({ CustomerProfile: () => <p>Customer profile</p>, getCustomerLevelLabel: () => '' }));
vi.mock('./CustomersList', () => ({ default: function List() {
    const [search, setSearch] = useState(() => { lifecycle.initialize(); return ''; });
    useEffect(() => { lifecycle.connect(); return () => { lifecycle.disconnect(); }; }, []);
    return <><input aria-label="Search customers" value={search} onChange={event => setSearch(event.target.value)} />
        <FormModal title="Customer form" onClose={() => {}}>Form contents</FormModal></>;
} }));
const props = { open: { selectedCustomer: null }, actions: {}, visits: {}, resources: {}, selectedCustomerId: null, list: {} } as unknown as CustomersViewProps;
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Retaining the Customers page', () => {
    it('loads only on the first visit and retains its search when switching pages', () => {
        const { rerender } = render(<CustomersView {...props} active={false} />);
        expect(lifecycle.initialize).not.toHaveBeenCalled();
        rerender(<CustomersView {...props} active />);
        fireEvent.change(screen.getByLabelText('Search customers'), { target: { value: 'Pacific' } });
        rerender(<CustomersView {...props} active={false} />);
        expect(screen.queryByRole('textbox', { name: 'Search customers' })).toBeNull();
        expect(screen.queryByRole('dialog', { name: 'Customer form' })).toBeNull();
        expect(lifecycle.disconnect).toHaveBeenCalledTimes(1);
        rerender(<CustomersView {...props} active />);
        expect((screen.getByLabelText('Search customers') as HTMLInputElement).value).toBe('Pacific');
        expect(lifecycle.initialize).toHaveBeenCalledTimes(1);
        expect(lifecycle.connect).toHaveBeenCalledTimes(2);
    });

    it('starts fresh when the signed-in account or permission scope changes', () => {
        const { rerender } = render(<CustomersView key="first-session" {...props} active />);
        fireEvent.change(screen.getByLabelText('Search customers'), { target: { value: 'Previous account' } });
        rerender(<CustomersView key="next-session" {...props} active={false} />);
        expect(screen.queryByRole('textbox', { name: 'Search customers' })).toBeNull();
        rerender(<CustomersView key="next-session" {...props} active />);
        expect((screen.getByLabelText('Search customers') as HTMLInputElement).value).toBe('');
    });
});
