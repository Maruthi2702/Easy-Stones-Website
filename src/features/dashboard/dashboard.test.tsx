// @vitest-environment jsdom
// The Dashboard's tab modules render from props and report changes through callbacks.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { permissions: [] }, loading: false }) }));
vi.mock('../../api/authFetch', () => ({ authFetch: () => Promise.resolve(new Response('{}')) }));

const { FollowUpsPanel } = await import('./followUps');
const { VisitsPanel } = await import('./visits');
const { default: ClientResources } = await import('./resources/ClientResources');
const { default: TeamFilesList } = await import('./resources/TeamFilesList');

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
  it('Client Updates: empty state', () => {
    render(
      <table><tbody>
        <ClientResources
          rows={[]} tableLoading={false} page={1} rowsPerPage={50} onPageChange={noop} onRowsPerPageChange={noop} loadingResourceId={null}
          onOpenCustomerResources={noop} onViewResource={noop} onEditResource={noop} onDeleteResource={noop} onOpenGallery={noop} onDownload={noop}
        />
      </tbody></table>
    );
    expect(screen.getByText('No resources found')).toBeTruthy();
  });
  it('Team Files: a folder row opens, and the empty state offers an upload', () => {
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
