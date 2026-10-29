// @vitest-environment jsdom
// The profile header: no Dashboard icon or Customers button; ✕ goes back; the ⋯ menu offers only what the login has.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ user: { permissions: [] }, loading: false }) }));
vi.mock('../../../api/authFetch', () => ({ authFetch: () => Promise.resolve(new Response('{}')) }));

const { default: CustomerProfileHeader } = await import('../list/CustomerProfileHeader');

afterEach(() => cleanup());
const noop = () => {};
const customer = { _id: 'c1', company: 'Stone Works & Design', customerType: 'Fabricator', status: 'New Lead', phone: '2065550147', visits: [{}], resources: [{}, {}], contacts: [{}, {}] };
const base = { customer, activeTab: 'visits', onTab: noop, onBack: noop, canEdit: false };

describe('Customer profile header', () => {
  it('has the ✕ (back to the list) and no Dashboard icon or Customers button', () => {
    const onBack = vi.fn();
    render(<CustomerProfileHeader {...base} onBack={onBack} />);
    expect(screen.queryByLabelText('Sales dashboard')).toBeNull();
    expect(screen.queryByText('Customers')).toBeNull();
    fireEvent.click(screen.getByLabelText('Close and back to customers'));
    expect(onBack).toHaveBeenCalled();
  });
  it('the ⋯ menu offers Edit and Delete only to a login that has them', () => {
    const onEditCustomer = vi.fn(); const onDeleteCustomer = vi.fn();
    const { rerender } = render(<CustomerProfileHeader {...base} canEditCustomer canDeleteCustomer onEditCustomer={onEditCustomer} onDeleteCustomer={onDeleteCustomer} />);
    fireEvent.click(screen.getByLabelText('More actions'));
    fireEvent.click(screen.getByText('Edit customer'));
    expect(onEditCustomer).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('More actions'));
    fireEvent.click(screen.getByText('Delete customer…'));
    expect(onDeleteCustomer).toHaveBeenCalled();
    rerender(<CustomerProfileHeader {...base} canEditCustomer />);
    fireEvent.click(screen.getByLabelText('More actions'));
    expect(screen.queryByText('Delete customer…')).toBeNull();
  });
  it('shows the tabs with counts and the active tab\'s Add button', () => {
    const onClick = vi.fn(); const onTab = vi.fn();
    render(<CustomerProfileHeader {...base} onTab={onTab} action={{ label: 'Add visit', onClick }} />);
    expect(screen.getByRole('tab', { name: 'Resources' }).textContent).toContain('2');
    fireEvent.click(screen.getByRole('tab', { name: 'Contacts' }));
    expect(onTab).toHaveBeenCalledWith('contacts');
    fireEvent.click(screen.getAllByLabelText('Add visit')[0]);
    expect(onClick).toHaveBeenCalled();
  });
  it('Left and Right move between tabs', () => {
    const onTab = vi.fn();
    render(<CustomerProfileHeader {...base} onTab={onTab} />);
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(onTab).toHaveBeenCalledWith('resources');
  });
});
