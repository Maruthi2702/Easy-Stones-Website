// @vitest-environment jsdom
// The Check-In module renders: the log (rows, loading, empty, filters, More),
// the Selection Sheet, and the check-in page's staff form and kiosk.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const USER = {
  _id: 'u1', id: 'u1', username: 'krish', name: 'Krish', role: 'admin', type: 'internal', assignedLocations: ['*'], location: 'Seattle',
  permissions: ['create_checkins', 'view_checkins', 'manage_checkins', 'delete_checkins', 'edit_selection_sheets', 'send_checkin_email', 'view_checkin_qr']
};
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: USER, loading: false, logout: async () => {} }) }));
vi.mock('../../api/authFetch', () => ({ authFetch: () => Promise.resolve(new Response('[]')) }));

const { default: CheckInLogPanel } = await import('./log/CheckInLogPanel');
const { default: SelectionSheetForm } = await import('./selectionSheet/SelectionSheetForm');
const { default: CheckInPage } = await import('./staff/CheckInPage');

const rows = [
  { _id: 'a', name: 'Sam Lee', phone: '(206) 555-0101', fabricatorCompany: 'Apex Granite', fabricatorPhone: '(206) 555-0199', location: 'Seattle', createdAt: new Date().toISOString() },
  { _id: 'b', name: 'Ana Ruiz', location: 'Spokane', createdAt: '2026-09-02T18:00:00Z' }
];
const panel = {
  checkIns: rows, onSearchChange: () => {}, onPageChange: () => {}, todayCount: 1, monthCount: 4, allTimeCount: 50, totalCount: 2,
  filterMonth: 10, filterYear: 2026, onFilterMonthChange: () => {}, onFilterYearChange: () => {}, onExport: () => {},
  onView: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), locations: ['Seattle', 'Spokane'], embedded: true
};
afterEach(() => cleanup());

describe('Check-In Log', () => {
  it('lists visitors with their counts', () => {
    render(<CheckInLogPanel {...panel} />);
    expect(screen.getAllByText('Sam Lee').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.clp-stat-val')[2].textContent).toBe('50');
    expect(screen.getByText('October 2026')).toBeTruthy();
  });
  it('shows loading and empty states', () => {
    const { rerender } = render(<CheckInLogPanel {...panel} loading />);
    expect(screen.getByText('Loading visitors...')).toBeTruthy();
    rerender(<CheckInLogPanel {...panel} checkIns={[]} searchTerm="zz" />);
    expect(screen.getByText('Try adjusting your search.')).toBeTruthy();
  });
  it('opens filters, the More menu and the QR codes', () => {
    const { container } = render(<CheckInLogPanel {...panel} />);
    fireEvent.click(container.querySelector('.clp-filter-btn') as Element);
    expect(screen.getByText('Filter Check-ins')).toBeTruthy();
    fireEvent.click(container.querySelector('.clp-more-btn') as Element);
    fireEvent.click(screen.getByText('QR / NFC codes'));
    expect(screen.getByText('QR Code & NFC Showroom Check-In')).toBeTruthy();
  });
  it('passes the row to View', () => {
    const { container } = render(<CheckInLogPanel {...panel} />);
    fireEvent.click(container.querySelector('.clp-actions-toggle-btn') as Element);
    fireEvent.click(screen.getAllByTitle('View details')[0]);
    expect(panel.onView).toHaveBeenCalledWith(rows[0]);
  });
});

describe('Selection Sheet', () => {
  it('shows the visit and its materials', () => {
    const checkIn = { _id: 'c1', name: 'Sam Lee', location: 'Seattle', createdAt: '2026-10-20T18:00:00Z', selections: [{ material: 'CALACATTA', lot: '13845', priceCentsPerSf: 6800 }] };
    render(<SelectionSheetForm checkIn={checkIn} owner="u1" canEdit canEmail onClose={() => {}} />);
    expect(screen.getByText('Selection Sheet - Seattle')).toBeTruthy();
    expect((document.getElementById('ss-mat-0') as HTMLInputElement).value).toBe('CALACATTA');
    expect((document.getElementById('ss-price-0') as HTMLInputElement).value).toBe('68.00');
  });
});

describe('Check-in page', () => {
  it('staff form at /checkin', () => {
    window.history.pushState({}, '', '/checkin');
    render(<MemoryRouter><CheckInPage /></MemoryRouter>);
    expect(screen.getByText('Visitor Check-In')).toBeTruthy();
    expect(screen.getByText('Check In Now')).toBeTruthy();
  });
  it('kiosk refuses a link without its branch, and opens with one', () => {
    window.history.pushState({}, '', '/self-checkin');
    const { unmount } = render(<MemoryRouter><CheckInPage /></MemoryRouter>);
    expect(screen.getByText('Kiosk Setup Required')).toBeTruthy();
    unmount();
    window.history.pushState({}, '', '/self-checkin?location=Spokane');
    render(<MemoryRouter><CheckInPage /></MemoryRouter>);
    expect(screen.getByText('Easy Stones — Spokane Showroom')).toBeTruthy();
  });
});
