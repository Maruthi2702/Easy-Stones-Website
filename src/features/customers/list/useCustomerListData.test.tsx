// @vitest-environment jsdom
import { Activity } from 'react';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCustomerListData } from './useCustomerListData';
import { clearListCache, globalPartnersCache, CUSTOMER_LIST_CACHE_TTL } from './listOptions';
import type { ListFilters } from './useListFilters';

const request = vi.hoisted(() => vi.fn<typeof fetch>());
vi.mock('../../../api/authFetch', () => ({ authFetch: request }));
const filters = { filterLevels: [], filterTypes: [], filterCities: [], filterStatuses: [], filterSalesReps: [], filterLocations: [], filterModa: [], view: '', letter: '' } as unknown as ListFilters;
const props = { activeTab: 'fabricators', filters, sortBy: 'company', sortOrder: 'asc', currentPage: 1, setCurrentPage: vi.fn(), limit: 50, cacheScope: 'user-1' };
const list = (name: string) => ({ partners: [{ _id: 'c1', company: name }], totalCount: 1, totalPages: 1 });
const listCalls = () => request.mock.calls.filter(([url]) => String(url).includes('/customers/list'));
beforeEach(() => {
    clearListCache(); request.mockReset();
    request.mockImplementation(async url => Response.json(String(url).includes('/customers/list') ? list('Pacific Granite') : {}));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function List() {
    const data = useCustomerListData(props);
    return <><span>{data.loading ? 'Loading customers' : 'Customers ready'}</span>{data.partners.map(row => <p key={row._id}>{row.company}</p>)}</>;
}

describe('Customer list reuse and refresh', () => {
    it('reuses the current list when returning to a retained page', async () => {
        const { rerender } = render(<Activity mode="visible"><List /></Activity>);
        await screen.findByText('Pacific Granite');
        rerender(<Activity mode="hidden"><List /></Activity>);
        rerender(<Activity mode="visible"><List /></Activity>);
        expect(screen.getByText('Customers ready')).toBeTruthy();
        expect(screen.getByText('Pacific Granite')).toBeTruthy();
        expect(listCalls()).toHaveLength(1);
    });

    it('shows the existing list while refreshing a change received while hidden', async () => {
        let resolve!: (response: Response) => void;
        const { rerender } = render(<Activity mode="visible"><List /></Activity>);
        await screen.findByText('Pacific Granite');
        rerender(<Activity mode="hidden"><List /></Activity>);
        clearListCache();
        request.mockImplementation(async url => String(url).includes('/customers/list') ? new Promise(r => { resolve = r; }) : Response.json({}));
        rerender(<Activity mode="visible"><List /></Activity>);
        expect(screen.getByText('Customers ready')).toBeTruthy();
        expect(screen.getByText('Pacific Granite')).toBeTruthy();
        expect(listCalls()).toHaveLength(2);
        await act(async () => { resolve(Response.json(list('Pacific Granite Updated'))); });
        expect(screen.getByText('Pacific Granite Updated')).toBeTruthy();
    });

    it('refreshes visible rows without switching back to the loading state', async () => {
        let resolve!: (response: Response) => void;
        const { result } = renderHook(() => useCustomerListData(props));
        await waitFor(() => expect(result.current.partners).toHaveLength(1));
        request.mockImplementation(async url => String(url).includes('/customers/list') ? new Promise(r => { resolve = r; }) : Response.json({}));
        act(() => result.current.refreshAll());
        expect(result.current.loading).toBe(false);
        expect(result.current.partners[0].company).toBe('Pacific Granite');
        await act(async () => { resolve(Response.json(list('Updated'))); });
        expect(result.current.partners[0].company).toBe('Updated');
    });

    it('refreshes an aged list quietly when returning even if no live update arrived', async () => {
        const now = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(now);
        const { rerender } = render(<Activity mode="visible"><List /></Activity>);
        await screen.findByText('Pacific Granite');
        rerender(<Activity mode="hidden"><List /></Activity>);
        vi.mocked(Date.now).mockReturnValue(now + CUSTOMER_LIST_CACHE_TTL + 1);
        let resolve!: (response: Response) => void;
        request.mockImplementation(async url => String(url).includes('/customers/list') ? new Promise(r => { resolve = r; }) : Response.json({}));
        rerender(<Activity mode="visible"><List /></Activity>);
        expect(screen.getByText('Customers ready')).toBeTruthy();
        expect(screen.getByText('Pacific Granite')).toBeTruthy();
        expect(listCalls()).toHaveLength(2);
        await act(async () => { resolve(Response.json(list('Updated'))); });
        expect(screen.getByText('Updated')).toBeTruthy();
    });

    it('does not reuse another user or permission scope’s cached rows', async () => {
        const first = renderHook(() => useCustomerListData(props));
        await waitFor(() => expect(first.result.current.partners).toHaveLength(1));
        first.unmount();
        request.mockImplementation(async url => Response.json(String(url).includes('/customers/list') ? list('Another user’s customers') : {}));
        const second = renderHook(() => useCustomerListData({ ...props, cacheScope: 'user-2' }));
        await waitFor(() => expect(second.result.current.partners[0]?.company).toBe('Another user’s customers'));
        expect(listCalls()).toHaveLength(2);
    });

    it('does not repopulate a cleared cache from a request whose page was unmounted', async () => {
        let resolve!: (response: Response) => void;
        request.mockImplementation(async url => String(url).includes('/customers/list') ? new Promise(r => { resolve = r; }) : Response.json({}));
        const { unmount } = renderHook(() => useCustomerListData(props));
        unmount(); clearListCache();
        await act(async () => { resolve(Response.json(list('Old session'))); });
        expect(Object.keys(globalPartnersCache)).toHaveLength(0);
    });
});
