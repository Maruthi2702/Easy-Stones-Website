// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProjectLeadsPage from './ProjectLeadsPage';
import type { Lead } from '../../api/projectLeads';

const api = vi.hoisted(() => ({ leadsMeta: vi.fn(), listLeads: vi.fn(), exportLeads: vi.fn(), updateLead: vi.fn(), importLeadsFile: vi.fn() }));
vi.mock('../../api/projectLeads', () => api);

const meta = {
  total: 1, states: [{ name: 'Texas', count: 1 }], stages: ['Post Bid'], subcategories: [{ name: 'Apartments', count: 1 }], cities: { Texas: ['Austin'] },
  assignees: [], lastImport: { fileName: 'cc.xlsx', projects: 1, added: 1, updated: 0, importedBy: 'Krish', importedAt: '2026-11-20T10:00:00.000Z' },
  canEdit: true, canImport: true, canExport: true
};
const lead: Lead = {
  id: '1001', title: 'Lulac Hacienda Apartments', value: 4_500_000, stage: 'Post Bid', subcategory: 'Apartments', bidDate: '', listedOn: '2026-01-01',
  updatedOn: '2026-06-01', address: '2625 Greenwood Dr', city: 'Austin', county: 'Travis', state: 'Texas', zip: '78744', floors: 3, floorArea: 60000,
  floorAreaUnit: 'Square Feet', siteArea: null, siteAreaUnit: '', stageNote: '', units: 60, ownerType: 'Private',
  status: 'new', assignedTo: '', note: '', statusBy: '', statusAt: '', history: [],
  companies: [
    { companyId: '1', name: 'Acme Owners', role: 'Owner', group: 'owner', address: '', city: 'Austin', state: 'Texas', zip: '', firstName: 'Ann', lastName: 'Lee', phone: '2065551234', email: 'ann@acme.test' },
    { companyId: '2', name: 'Eng Co', role: 'Civil Engineer', group: 'other', address: '', city: '', state: '', zip: '', firstName: '', lastName: '', phone: '', email: '' }
  ]
};

beforeEach(() => {
  vi.clearAllMocks();
  api.leadsMeta.mockResolvedValue(meta);
  api.listLeads.mockResolvedValue({ items: [lead], counts: { new: 1 }, total: 1 });
  api.updateLead.mockImplementation(async (_id: string, change: Record<string, unknown>) => ({ ...lead, ...change }));
});
afterEach(cleanup);

describe('Project Leads page', () => {
  it('lists projects with the people to call and opens one with a way to phone or email them', async () => {
    render(<ProjectLeadsPage currentUser={{ name: 'Sam' }} />);
    expect(await screen.findByText('Lulac Hacienda Apartments')).toBeTruthy();
    expect(api.listLeads).toHaveBeenCalledWith(expect.objectContaining({ page: 1, sort: 'updated_desc' }));
    expect(screen.getByText('Acme Owners')).toBeTruthy();
    fireEvent.click(screen.getByText('Lulac Hacienda Apartments'));
    const dialog = await screen.findByRole('dialog', { name: 'Lulac Hacienda Apartments' });
    expect(dialog.querySelector('a[href="tel:2065551234"]')).toBeTruthy();
    expect(dialog.querySelector('a[href^="mailto:ann@acme.test"]')).toBeTruthy();
    // Engineers sit behind a fold.
    expect(dialog.querySelector('details')?.hasAttribute('open')).toBe(false);
  });

  it('saves a status and takes the lead', async () => {
    render(<ProjectLeadsPage currentUser={{ name: 'Sam' }} />);
    fireEvent.click(await screen.findByText('Lulac Hacienda Apartments'));
    fireEvent.click(await screen.findByRole('button', { name: 'Samples sent' }));
    await waitFor(() => expect(api.updateLead).toHaveBeenCalledWith('1001', { status: 'samples' }));
    fireEvent.click(screen.getByRole('button', { name: 'Take this lead' }));
    await waitFor(() => expect(api.updateLead).toHaveBeenCalledWith('1001', { assignedTo: 'Sam' }));
  });

  it('makes a customer from a company, prefilled', async () => {
    const onCreateCustomer = vi.fn();
    render(<ProjectLeadsPage currentUser={{ name: 'Sam' }} onCreateCustomer={onCreateCustomer} />);
    fireEvent.click(await screen.findByText('Lulac Hacienda Apartments'));
    fireEvent.click((await screen.findAllByRole('button', { name: /Create customer/ }))[0]);
    expect(onCreateCustomer).toHaveBeenCalledWith(expect.objectContaining({ company: 'Acme Owners', customerType: 'Builder', phone: '(206) 555-1234', email: 'ann@acme.test' }));
  });

  it('filters by status tab and shows the empty state with an import hint', async () => {
    api.listLeads.mockResolvedValue({ items: [], counts: {}, total: 0 });
    api.leadsMeta.mockResolvedValue({ ...meta, total: 0, lastImport: null });
    render(<ProjectLeadsPage />);
    expect(await screen.findByRole('heading', { name: 'No project leads yet' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Contacted/ }));
    await waitFor(() => expect(api.listLeads).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'contacted' })));
  });

  it('hides Import and Export without those switches, and shows a load error with Retry', async () => {
    api.leadsMeta.mockResolvedValue({ ...meta, canImport: false, canExport: false, canEdit: false });
    api.listLeads.mockRejectedValueOnce(new Error('Leads unavailable'));
    render(<ProjectLeadsPage />);
    expect((await screen.findByRole('alert')).textContent).toContain('Leads unavailable');
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});
