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
  const resources = [{ _id: 'r1', date: '2026-10-01', customerId: 'c1', resourceType: 'Moda Tower 2024 version 2', location: 'Seattle', description: 'Placed in showroom', image: [] }];
  const props = {
    resources, customers: [{ _id: 'c1', company: 'Pacific Granite' }], currentUser: admin, currentUserId: 'u1', loadingResourceId: null, canAddVisits: true,
    onAddResource: noop, onViewResource: noop, onEditResource: noop, onDeleteResource: noop, onOpenGallery: noop,
    expandedResourceId: null as string | null, setExpandedResourceId: noop
  };
  it('lists a resource with its client, and opens its row', () => {
    const setExpandedResourceId = vi.fn();
    render(<ResourcesTab {...props} setExpandedResourceId={setExpandedResourceId} />);
    expect(screen.getByText('Pacific Granite')).toBeTruthy();
    fireEvent.click(screen.getByText('Moda Tower 2024 version 2'));
    expect(setExpandedResourceId).toHaveBeenCalledWith('r1');
  });
  it('shows details when expanded, and an empty state', () => {
    const { rerender } = render(<ResourcesTab {...props} expandedResourceId="r1" />);
    expect(screen.getByText('Placed in showroom')).toBeTruthy();
    expect(screen.getByText('No attachments')).toBeTruthy();
    rerender(<ResourcesTab {...props} resources={[]} />);
    expect(screen.getByText('No resources found')).toBeTruthy();
  });
  it('Add Resource calls back', () => {
    const onAddResource = vi.fn();
    render(<ResourcesTab {...props} onAddResource={onAddResource} />);
    fireEvent.click(screen.getByText('Add Resource'));
    expect(onAddResource).toHaveBeenCalled();
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
    fireEvent.click(screen.getByText('Link Your First Partner'));
    expect(onLinkPartner).toHaveBeenCalled();
  });
});

describe('Visits tab', () => {
  const props = {
    visits: [], loading: false, currentUser: admin, currentUserId: 'u1', canAddVisits: true, onAddContact: noop, onAddResource: noop, onAddVisit: noop,
    onReaction: noop, onEditVisit: noop, onDeleteVisit: noop, onOpenGallery: noop, activeReactionMessageId: null, setActiveReactionMessageId: noop
  };
  it('says so when empty, and while loading', () => {
    const { rerender } = render(<VisitsTab {...props} />);
    expect(screen.getByText('No posts yet. Be the first to post!')).toBeTruthy();
    rerender(<VisitsTab {...props} loading />);
    expect(screen.getByText('Loading customer history...')).toBeTruthy();
  });
  it('Add Visit and Add Contact call back', () => {
    const onAddVisit = vi.fn(); const onAddContact = vi.fn();
    render(<VisitsTab {...props} onAddVisit={onAddVisit} onAddContact={onAddContact} />);
    fireEvent.click(screen.getByText('Add Visit'));
    fireEvent.click(screen.getByText('Add Contact'));
    expect(onAddVisit).toHaveBeenCalled();
    expect(onAddContact).toHaveBeenCalled();
  });
});
