// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import CustomerContactsTab from '../list/CustomerContactsTab';
const noop = vi.fn();
const props = { customer: { company: 'Example', contacts: [{ _id: 'c1', name: 'Pat', email: 'pat@example.invalid' }] }, onAdd: noop, onEdit: noop, onDelete: noop };
afterEach(cleanup);
describe('read-only contacts', () => {
  it('shows contact information without edit or delete menus', () => {
    render(<CustomerContactsTab {...props} canManage={false} />);
    expect(screen.getAllByText('Pat').length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('Contact actions')).toBeNull();
  });
  it('does not offer an empty-tab add action without permission', () => {
    render(<CustomerContactsTab {...props} customer={{}} canManage={false} />);
    expect(screen.queryByRole('button', { name: 'Add contact' })).toBeNull();
  });
  it('retains editing actions for permitted users', () => {
    render(<CustomerContactsTab {...props} canManage />);
    expect(screen.getAllByLabelText('Contact actions').length).toBeGreaterThan(0);
  });
});
