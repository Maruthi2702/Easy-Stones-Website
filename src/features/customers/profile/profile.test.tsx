// @vitest-environment jsdom
// The customer profile's tabs render from props and report clicks through callbacks.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ user: { permissions: [] }, loading: false }) }));
vi.mock('../../../api/authFetch', () => ({ authFetch: () => Promise.resolve(new Response('{}')) }));

const { ResourcesTab, NetworkTab, VisitsTab } = await import('./index');

afterEach(() => cleanup());
const noop = () => {};
const admin = { permissions: ['view_all_visits', 'delete_all_visits', 'edit_all_visits'], role: 'admin' };

describe('Resources tab', () => {
  const resources = [
    { _id: 'r1', date: '2026-04-15', customerId: 'c1', resourceType: 'Moda Tower 2024 version 2', location: 'Seattle', description: 'Placed in showroom', uploadedByName: 'Dana W', image: [] },
    { _id: 'r2', date: '2026-10-08', customerId: 'c1', resourceType: 'Sample binder', qty: 3, status: 'Inactive', uploadedByName: 'Krish', image: [] }
  ];
  const props = {
    resources, currentUser: admin, currentUserId: 'u1', loadingResourceId: null, canAddVisits: true,
    onAddResource: noop, onViewResource: noop, onEditResource: noop, onDeleteResource: noop
  };
  it('lists resources the way Dashboard → Resources does, newest first, without a Customer column', () => {
    render(<ResourcesTab {...props} />);
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent);
    expect(headers).toEqual(['Date', 'Resource', 'Qty', 'Note', 'Logged by', 'Actions']);
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0].textContent).toContain('Sample binder');
    expect(rows[0].textContent).toContain('Inactive');
    expect(rows[1].textContent).toContain('Placed in showroom');
    expect(rows[1].textContent).toContain('Dana W');
  });
  it('a row opens the resource; an empty tab says so', () => {
    const onViewResource = vi.fn();
    const { rerender } = render(<ResourcesTab {...props} onViewResource={onViewResource} />);
    fireEvent.click(screen.getByText('Moda Tower 2024 version 2'));
    expect(onViewResource).toHaveBeenCalledWith(resources[0]);
    rerender(<ResourcesTab {...props} resources={[]} />);
    expect(screen.getByText('No resources yet')).toBeTruthy();
  });
  it('the empty tab holds its own Add resource button (the header\'s hides while empty)', () => {
    const onAddResource = vi.fn();
    render(<ResourcesTab {...props} resources={[]} onAddResource={onAddResource} />);
    fireEvent.click(screen.getByText('Add resource'));
    expect(onAddResource).toHaveBeenCalled();
  });
  it('a row\'s View, Edit and Delete are in its ⋯ menu', () => {
    const onEditResource = vi.fn(); const onDeleteResource = vi.fn();
    render(<ResourcesTab {...props} resources={[resources[0]]} onEditResource={onEditResource} onDeleteResource={onDeleteResource} />);
    fireEvent.click(screen.getByLabelText('Resource actions'));
    fireEvent.click(screen.getByText('Edit'));
    expect(onEditResource).toHaveBeenCalledWith(resources[0]);
    fireEvent.click(screen.getByLabelText('Resource actions'));
    fireEvent.click(screen.getByText('Delete'));
    expect(onDeleteResource).toHaveBeenCalledWith('r1', 'c1');
  });
});

describe('Network tab', () => {
  const customer = { associatedCustomers: [{ _id: 'p1', company: 'Stone River', contactName: 'Max', customerType: 'Fabricator', status: 'Active' }] };
  it('groups partners and opens or unlinks one', () => {
    const onOpenCustomer = vi.fn(); const onUnlink = vi.fn();
    render(<NetworkTab customer={customer} onOpenCustomer={onOpenCustomer} onUnlink={onUnlink} onLinkPartner={noop} />);
    expect(screen.getByText('Associated Fabricators (1)')).toBeTruthy();
    fireEvent.click(screen.getByText('View Profile'));
    expect(onOpenCustomer).toHaveBeenCalledWith(customer.associatedCustomers[0]);
    fireEvent.click(screen.getByText('Unlink'));
    expect(onUnlink).toHaveBeenCalledWith('p1', 'Stone River');
  });
  it('invites the first link when there are none', () => {
    const onLinkPartner = vi.fn();
    render(<NetworkTab customer={{}} onOpenCustomer={noop} onUnlink={noop} onLinkPartner={onLinkPartner} />);
    fireEvent.click(screen.getByText('Link partner'));
    expect(onLinkPartner).toHaveBeenCalled();
  });
});

describe('Visits tab', () => {
  const props = {
    visits: [], loading: false, currentUser: admin, currentUserId: 'u1', canAddVisits: true, onAddVisit: noop,
    onReaction: noop, onEditVisit: noop, onDeleteVisit: noop, onOpenGallery: noop, activeReactionMessageId: null, setActiveReactionMessageId: noop
  };
  it('says so when empty, and while loading', () => {
    const { rerender } = render(<VisitsTab {...props} />);
    expect(screen.getByText('No visits yet')).toBeTruthy();
    rerender(<VisitsTab {...props} loading />);
    expect(screen.getByRole('status')).toBeTruthy();
  });
  it('the empty tab holds its own Add visit button, and only with permission', () => {
    const onAddVisit = vi.fn();
    const { rerender } = render(<VisitsTab {...props} onAddVisit={onAddVisit} />);
    fireEvent.click(screen.getByText('Add visit'));
    expect(onAddVisit).toHaveBeenCalled();
    rerender(<VisitsTab {...props} canAddVisits={false} onAddVisit={onAddVisit} />);
    expect(screen.queryByText('Add visit')).toBeNull();
  });
});
