// @vitest-environment jsdom
// The Dashboard's tab modules render from props and report changes through callbacks.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { permissions: [] }, loading: false }) }));
vi.mock('../../api/authFetch', () => ({ authFetch: () => Promise.resolve(new Response('{}')) }));

const { FollowUpsPanel } = await import('./followUps');
const { VisitsPanel } = await import('./visits');
const { ResourcesPanel } = await import('./resources');
const { default: TeamFilesList } = await import('../teamFiles/components/TeamFilesList');

afterEach(() => cleanup());
const noop = () => {};

describe('Follow-ups tab', () => {
  const props = {
    rows: [{ _id: 'f1', displayDate: '2026-10-20', customerId: 'c1', customerName: 'Pacific Granite', displayNote: 'Send quote', source: 'Visit' }],
    filter: 'all' as const, onFilterChange: noop, locationOptions: [], location: '', onLocationChange: noop, currentUser: null,
    searchTerm: '', onSearchChange: noop, page: 1, rowsPerPage: 50, onPageChange: noop, onRowsPerPageChange: noop, tableLoading: false,
    onExport: noop, onOpenPlanner: noop, onViewVisit: noop, onEditVisit: noop, onOpenCustomer: noop
  };
  it('lists a follow-up and opens its customer', () => {
    const onOpenCustomer = vi.fn();
    render(<FollowUpsPanel {...props} onOpenCustomer={onOpenCustomer} />);
    fireEvent.click(screen.getByText('Pacific Granite'));
    expect(onOpenCustomer).toHaveBeenCalledWith('c1');
    expect(screen.getByText('Send quote')).toBeTruthy();
  });
  it('says so when there is nothing, and when it is loading', () => {
    const { rerender } = render(<FollowUpsPanel {...props} rows={[]} />);
    expect(screen.getByText('No follow-up notes found')).toBeTruthy();
    rerender(<FollowUpsPanel {...props} rows={[]} tableLoading />);
    expect(screen.getByText(/Loading/)).toBeTruthy();
  });
  it('the Next Week button asks for that filter', () => {
    const onFilterChange = vi.fn();
    render(<FollowUpsPanel {...props} onFilterChange={onFilterChange} />);
    fireEvent.click(screen.getByText('Next Week'));
    expect(onFilterChange).toHaveBeenCalledWith('nextWeek');
  });
});

describe('Sales Visits tab', () => {
  it('shows the visit list with its Today and Follow-ups panels', () => {
    render(
      <VisitsPanel
        pagedVisits={[{ _id: 'v1', date: '2026-10-20', company: 'Stone River', contactName: 'Max', customerId: 'c2', location: 'Seattle' }]}
        totalCount={1} searchTerm="" onSearchChange={noop} page={1} rowsPerPage={50} onPageChange={noop} onRowsPerPageChange={noop}
        tableLoading={false} busyVisitId={null} currentUser={{ permissions: ['view_customers'] }} currentUserId="u1" customers={[]} schedules={[]}
        followUpPanel={[]} followUpCount={0} onOpenTab={noop} onOpenVisitCard={noop} onEditVisit={noop} onDeleteVisit={noop}
        onOpenGallery={noop} onOpenCustomer={noop}
      />
    );
    expect(screen.getByText('Stone River')).toBeTruthy();
    expect(screen.getByText('Nothing on the calendar today')).toBeTruthy();
    expect(screen.getByText('No follow-ups in this period.')).toBeTruthy();
  });
});

describe('Resources tab', () => {
  const panel = (over: Record<string, unknown> = {}) => ({
    rows: [] as Record<string, unknown>[], tableLoading: false, page: 1, rowsPerPage: 50, onPageChange: noop, onRowsPerPageChange: noop,
    searchTerm: '', onSearchChange: noop, locationOptions: [], location: '', onLocationChange: noop,
    currentUser: { permissions: ['edit_own_visits'] }, currentUserId: 'u1', loadingResourceId: null,
    onViewResource: noop, onEditResource: noop, onDeleteResource: noop, onExportView: noop, onExportAll: noop,
    ...over
  });
  const rows = [
    { _id: 'r1', customerId: 'c1', company: 'TopLine Counters', contactName: 'Gabe', city: 'Kent', resourceType: 'Moda Sample Binder NorthWest V1 12', qty: 6, date: '2026-10-09', description: 'For Gabe', uploadedBy: 'u1', uploadedByName: 'Krish' },
    { _id: 'r2', customerId: 'c2', company: 'Casey’s Flooring', resourceType: '2025V3 Moda Tower', date: '2026-10-13', uploadedBy: 'u2', uploadedByName: 'Dave' }
  ];

  it('says so when the period has none', () => {
    render(<ResourcesPanel {...panel()} />);
    expect(screen.getByText('No resources for this period.')).toBeTruthy();
  });

  it('shows each resource with its qty (1 when unsaid), and a click opens it', () => {
    const onViewResource = vi.fn();
    const { container } = render(<ResourcesPanel {...panel({ rows, onViewResource })} />);
    expect(screen.getByText('TopLine Counters')).toBeTruthy();
    expect([...container.querySelectorAll('tbody td.rs-num')].map((td) => td.textContent)).toEqual(['6', '1']);
    fireEvent.click(screen.getByText('Casey’s Flooring'));
    expect(onViewResource).toHaveBeenCalledWith(rows[1]);
  });

  it('filters by resource type from the Filters panel, with a tag to take it off', () => {
    render(<ResourcesPanel {...panel({ rows })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    expect(screen.getByText('Display towers')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: /2025V3 Moda Tower/ }));
    expect(screen.queryByText('TopLine Counters')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove 2025V3 Moda Tower' }));
    expect(screen.getByText('TopLine Counters')).toBeTruthy();
  });
});

describe('Team Files page', () => {
  it('a folder row opens, and the empty state offers an upload', () => {
    const onResourceClick = vi.fn();
    const files = [{ _id: 'r1', name: 'Brochures', type: 'folder', createdAt: '2026-10-01T10:00:00Z' }];
    const { rerender } = render(
      <TeamFilesList resources={files} folderPath={[]} searchTerm="" onBreadcrumbClick={noop} onResourceClick={onResourceClick} onEditResource={noop} onDeleteResource={noop} onOpenUpload={noop} />
    );
    fireEvent.click(screen.getByText('Brochures'));
    expect(onResourceClick).toHaveBeenCalledWith(files[0]);
    const onOpenUpload = vi.fn();
    rerender(<TeamFilesList resources={[]} folderPath={[]} searchTerm="" onBreadcrumbClick={noop} onResourceClick={noop} onEditResource={noop} onDeleteResource={noop} onOpenUpload={onOpenUpload} />);
    fireEvent.click(screen.getByText('Upload your first file'));
    expect(onOpenUpload).toHaveBeenCalled();
  });
});
