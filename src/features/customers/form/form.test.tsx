// @vitest-environment jsdom
// Add / Edit customer renders: a new customer with its defaults, the banner
// after an empty save, a possible duplicate, the ZIP lookup, the business-card
// menu, Edit with Delete, and the old read-only View. The API is a fake keyed on the URL.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

const USER = { _id: 'u1', id: 'u1', name: 'Krish', role: 'sales_rep', location: 'Seattle', assignedLocations: ['Seattle'] };
const answer = (url: string) => {
  const u = String(url);
  const body = u.includes('/possible-duplicates') ? { matches: [{ customer: { _id: 'c1', company: 'Pacific Granite', address: { city: 'Seattle' }, location: 'Seattle' }, signals: ['company name'] }] }
    : u.includes('/api/geocode/zip/98101') ? { city: 'Seattle', state: 'WA' }
      : u.includes('/api/salesreps') ? { data: [{ _id: 'u1', name: 'Krish', role: 'sales_rep', location: 'Seattle', assignedLocations: ['Seattle'] }] }
        : u.includes('/api/admin/locations') ? [{ name: 'Seattle' }, { name: 'Spokane' }]
          : [];
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
};
vi.mock('../../../api/authFetch', () => ({ authFetch: (u: string) => answer(u) }));
vi.mock('tesseract.js', () => ({ default: { recognize: () => Promise.resolve({ data: { text: '' } }) } }));

// jsdom has no scrolling; an empty save scrolls to the first field with an error.
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = function scrollIntoView() {};
const { default: AddCustomerModal } = await import('./AddCustomerModal');
const settle = async (ms = 10, n = 5) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const reps = [{ _id: 'u1', name: 'Krish', location: 'Seattle' }, { _id: 'u2', name: 'Rita', location: 'Spokane' }];
const base = { show: true, onClose: () => {}, onSave: vi.fn(), salesReps: reps, locations: ['Seattle', 'Spokane'], currentUser: USER };
const input = (id: string) => document.getElementById(id) as HTMLInputElement;

afterEach(() => cleanup());

describe('Add / Edit customer', () => {
  it('opens a new customer at your branch, with you as the rep', async () => {
    render(<AddCustomerModal {...base} />);
    await settle();
    expect(screen.getByText('Add a customer')).toBeTruthy();
    expect(document.querySelector('#cf-location')?.textContent).toContain('Seattle');
    expect(document.querySelector('#cf-salesRep')?.textContent).toContain('Krish');
  });
  it('shows the banner and does not save when the required fields are empty', async () => {
    render(<AddCustomerModal {...base} />);
    await settle();
    fireEvent.click(screen.getByText('Add customer'));
    expect(document.querySelector('.fm-banner')).toBeTruthy();
    expect(base.onSave).not.toHaveBeenCalled();
  });
  it('saves the values with the close function', async () => {
    const onSave = vi.fn();
    render(<AddCustomerModal {...base} onSave={onSave} />);
    await settle();
    fireEvent.change(input('cf-company'), { target: { value: 'Harbor Stone' } });
    fireEvent.change(input('cf-email'), { target: { value: 'al@hs.com' } });
    fireEvent.click(screen.getByText('Add customer'));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({ company: 'Harbor Stone', email: 'al@hs.com', marketingEmail: 'al@hs.com', location: 'Seattle' });
    expect(typeof onSave.mock.calls[0][1]).toBe('function');
  });
  it('warns about a possible duplicate, and hides it on request', async () => {
    const onOpenExisting = vi.fn();
    render(<AddCustomerModal {...base} onOpenExisting={onOpenExisting} />);
    await settle();
    fireEvent.change(input('cf-company'), { target: { value: 'Pacific' } });
    await settle(150, 6);
    expect(screen.getByText('This may be a customer you already have')).toBeTruthy();
    fireEvent.click(screen.getByText('Open it'));
    expect(onOpenExisting).toHaveBeenCalledWith(expect.objectContaining({ _id: 'c1' }));
  });
  it('fills city and state from the ZIP', async () => {
    render(<AddCustomerModal {...base} />);
    await settle();
    fireEvent.change(input('cf-zipCode'), { target: { value: '98101' } });
    fireEvent.blur(input('cf-zipCode'));
    await settle();
    expect(input('cf-city').value).toBe('Seattle');
    expect(input('cf-state').value).toBe('WA');
  });
  it('opens the business-card menu', async () => {
    render(<AddCustomerModal {...base} />);
    await settle();
    fireEvent.click(document.querySelector('.cf-plus-btn') as Element);
    expect(screen.getByText('Scan card')).toBeTruthy();
    expect(screen.getByText('Upload card photo')).toBeTruthy();
  });
  it('edits a customer, with Delete until something changes', async () => {
    const customer = { _id: 'c1', company: 'Pacific Granite', email: 'v@pg.com', location: 'Seattle', salesRep: 'u9', salesRepName: 'Old Rep' };
    render(<AddCustomerModal {...base} editingCustomer={customer} onDelete={() => true} />);
    await settle();
    expect(screen.getByText('Edit customer')).toBeTruthy();
    expect((screen.getByText('Delete customer').closest('button') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByText('Save changes').closest('button') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input('cf-company'), { target: { value: 'Pacific Granite 2' } });
    expect((screen.getByText('Delete customer').closest('button') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText('Save changes').closest('button') as HTMLButtonElement).disabled).toBe(false);
  });
  it('keeps the old read-only View', async () => {
    render(<AddCustomerModal {...base} viewingCustomer={{ _id: 'c1', company: 'Pacific Granite', email: 'v@pg.com' }} />);
    await settle();
    expect(screen.getByText('View Customer')).toBeTruthy();
    expect((document.querySelector('.add-customer-modal input') as HTMLInputElement).disabled).toBe(true);
  });
});
