// @vitest-environment jsdom
// The Dashboard's tab modules render from props and report changes through callbacks.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { permissions: [] }, loading: false }) }));
vi.mock('../../api/authFetch', () => ({ authFetch: () => Promise.resolve(new Response('{}')) }));

const { FollowUpsPanel } = await import('./followUps');
const { VisitsPanel } = await import('./visits');
const { VisitsViewSwitch } = await import('./components/RepBreakdownTable');
const { ResourcesPanel } = await import('./resources');
const { default: TeamFilesList } = await import('../teamFiles/components/TeamFilesList');

afterEach(() => cleanup());
const noop = () => {};

describe('Follow-ups tab', () => {
  const props = {
    rows: [{ _id: 'f1', displayDate: '2026-10-20', customerId: 'c1', customerName: 'Pacific Granite', displayNote: 'Send quote', source: 'Visit' }],
    filter: 'all' as const, onFilterChange: noop, locationOptions: [], location: '', onLocationChange: noop, currentUser: null,
    searchTerm: '', onSearchChange: noop, page: 1, rowsPerPage: 50, onPageChange: noop, onRowsPerPageChange: noop, tableLoading: false,
    onExport: noop, onOpenPlanner: noop, onViewVisit: noop, onEditVisit: noop, onOpenCustomer: noop, people: null
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

describe('People filter (manager view)', () => {
  const rows = [{ _id: 'f1', displayDate: '2026-10-20', customerId: 'c1', customerName: 'Pacific Granite', displayNote: 'Send quote', source: 'Visit', createdByName: 'Jesus B.' }];
  const base = {
    rows, filter: 'all' as const, onFilterChange: noop, locationOptions: [], location: '', onLocationChange: noop, currentUser: null,
    searchTerm: '', onSearchChange: noop, page: 1, rowsPerPage: 50, onPageChange: noop, onRowsPerPageChange: noop, tableLoading: false,
    onExport: noop, onOpenPlanner: noop, onViewVisit: noop, onEditVisit: noop, onOpenCustomer: noop
  };
  const people = (over = {}) => ({
    options: [
      { value: 'me1', id: 'me1', label: 'Krish', location: 'Seattle', inactive: false },
      { value: 'j', id: 'j', label: 'Jesus B.', location: 'Seattle', inactive: false },
      { value: 'b', id: 'b', label: 'Bart A.', location: 'Kent', inactive: true }
    ],
    value: ['me1'], me: 'me1', onChange: vi.fn(), onToggle: vi.fn(), active: false, onReset: vi.fn(), summary: 'Me', ...over
  });

  it('offers Me, My team and the reps by branch, and passes picks back', () => {
    const p = people();
    render(<FollowUpsPanel {...base} people={p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    expect(screen.getByText('People')).toBeTruthy();
    expect(screen.getByText('Krish (you)')).toBeTruthy();
    expect(screen.getByText('Kent')).toBeTruthy();
    expect(screen.getByText(/inactive/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('My team'));
    expect(p.onChange).toHaveBeenCalledWith([]);
    fireEvent.click(screen.getByLabelText('Jesus B.'));
    expect(p.onToggle).toHaveBeenCalledWith('j');
    fireEvent.click(screen.getByText('Clear Filter'));
    expect(p.onReset).toHaveBeenCalled();
  });

  it('shows a Rep column only when more than the viewer is in view', () => {
    const { rerender } = render(<FollowUpsPanel {...base} people={people()} />);
    expect(screen.queryByText('Rep')).toBeNull();
    rerender(<FollowUpsPanel {...base} people={people({ value: [] })} showWhoLogged />);
    expect(screen.getByText('Rep')).toBeTruthy();
    expect(screen.getByText('Jesus B.')).toBeTruthy();
  });
});

describe('Sales Visits → By rep', () => {
  const rows = [
    { id: 'j', name: 'Jesus B.', branch: 'Seattle', you: false, inactive: false, visits: 5, resources: 1, followUps: 3, late: 2, todayStops: 2 },
    { id: 'me1', name: 'Krish', branch: 'Seattle', you: true, inactive: false, visits: 1, resources: 0, followUps: 0, late: 0, todayStops: 0 },
    { id: '', name: 'Not recorded', branch: '', you: false, inactive: false, visits: 1, resources: 0, followUps: 0, late: 0, todayStops: 0 }
  ];
  const panel = (byRep: Record<string, unknown>) => (
    <VisitsPanel
      pagedVisits={[{ _id: 'v1', date: '2026-10-20', company: 'Stone River', contactName: 'Max', customerId: 'c2', location: 'Seattle' }]}
      totalCount={1} searchTerm="" onSearchChange={noop} page={1} rowsPerPage={50} onPageChange={noop} onRowsPerPageChange={noop}
      tableLoading={false} busyVisitId={null} currentUser={{ permissions: [] }} currentUserId="me1" customers={[]} schedules={[]}
      followUpPanel={[]} followUpCount={0} showWhoLogged
      byRep={{ view: 'list', onViewChange: noop, rows, onPick: noop, ...byRep }}
      onOpenTab={noop} onOpenVisitCard={noop} onEditVisit={noop} onDeleteVisit={noop} onOpenGallery={noop} onOpenCustomer={noop}
    />
  );

  it('the switch (in the Filters panel) asks for the By rep view, and the card no longer holds it', () => {
    const onViewChange = vi.fn();
    const { unmount } = render(panel({}));
    expect(screen.getByText('Stone River')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'By rep' })).toBeNull();
    unmount();
    render(<VisitsViewSwitch value="list" onChange={onViewChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'By rep' }));
    expect(onViewChange).toHaveBeenCalledWith('byRep');
  });

  it('shows a row per person with a total, and a row opens their work', () => {
    const onPick = vi.fn();
    const { container } = render(panel({ view: 'byRep', onPick }));
    expect(screen.queryByText('Stone River')).toBeNull();
    expect(screen.queryByPlaceholderText('Search visits...')).toBeNull();
    expect(screen.getByText('Krish (you)')).toBeTruthy();
    expect([...container.querySelectorAll('tfoot td')].map((td) => td.textContent)).toEqual(['7', '1', '3', '2']);
    fireEvent.click(screen.getByText('Jesus B.'));
    expect(onPick).toHaveBeenCalledWith('j');
    onPick.mockClear();
    fireEvent.click(screen.getByText('Not recorded'));
    expect(onPick).not.toHaveBeenCalled();
  });
});

describe('Sales Visits tab', () => {
  it('shows the visit list with its Today and Follow-ups panels', () => {
    render(
      <VisitsPanel
        pagedVisits={[{ _id: 'v1', date: '2026-10-20', company: 'Stone River', contactName: 'Max', customerId: 'c2', location: 'Seattle' }]}
        totalCount={1} searchTerm="" onSearchChange={noop} page={1} rowsPerPage={50} onPageChange={noop} onRowsPerPageChange={noop}
        tableLoading={false} busyVisitId={null} currentUser={{ permissions: ['view_customers'] }} currentUserId="u1" customers={[]} schedules={[]}
        followUpPanel={[]} followUpCount={0} showWhoLogged={false} byRep={null} onOpenTab={noop} onOpenVisitCard={noop} onEditVisit={noop} onDeleteVisit={noop}
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
    searchTerm: '', onSearchChange: noop, locationOptions: [], location: '', onLocationChange: noop, people: null,
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
