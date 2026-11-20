// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProjectLeadsPage from './ProjectLeadsPage';
import LeadImportModal from './LeadImportModal';
import type { Lead } from '../../api/projectLeads';

const api = vi.hoisted(() => ({ leadsMeta: vi.fn(), listLeads: vi.fn(), exportLeads: vi.fn(), updateLead: vi.fn(), importLeadsFile: vi.fn(), previewLeadsFile: vi.fn(), undoLeadsImport: vi.fn() }));
vi.mock('../../api/projectLeads', () => api);

const meta = {
  total: 1, states: [{ name: 'Texas', count: 1 }], stages: ['Post Bid'], subcategories: [{ name: 'Apartments', count: 1 }], cities: { Texas: ['Austin'] },
  assignees: [], lastImport: { id: 'imp1', canUndo: true, undone: false, fileName: 'cc.xlsx', projects: 1, added: 1, updated: 0, importedBy: 'Krish', importedAt: '2026-11-20T10:00:00.000Z' },
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

const preview = {
  projects: 120, companies: 800, added: 20, refreshed: 30, unchanged: 70, contactsAdded: 12, contactsRemoved: 3, older: 0, notInFile: 5, skippedRows: 0,
  samples: [{ id: '1001', title: 'Lulac Hacienda', changes: [{ label: 'Value', from: '4000000', to: '4500000' }] }]
};
const pick = (name = 'cc.xlsx') => {
  const input = screen.getByLabelText('ConstructConnect file') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['x'], name)] } });
};

describe('Import ConstructConnect file', () => {
  it('checks the file, shows what would change, imports on the last step and offers Undo', async () => {
    api.previewLeadsFile.mockResolvedValue(preview);
    api.importLeadsFile.mockResolvedValue({ importId: 'imp2', projects: 120, companies: 800, added: 20, updated: 100, skippedRows: 0 });
    api.undoLeadsImport.mockResolvedValue({ restored: 100, removed: 20, kept: 0 });
    const onDone = vi.fn();
    render(<LeadImportModal onClose={() => {}} onDone={onDone} />);
    pick();
    expect(await screen.findByText('File check')).toBeTruthy();
    expect(api.importLeadsFile).not.toHaveBeenCalled();   // nothing saved yet
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Some of the changes')).toBeTruthy();
    expect(screen.getByText(/Statuses, who has a lead and notes are never changed/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Import 120 projects' }));
    await waitFor(() => expect(api.importLeadsFile).toHaveBeenCalledTimes(1));
    expect(onDone).toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Undo this import' }));
    await waitFor(() => expect(api.undoLeadsImport).toHaveBeenCalledWith('imp2'));
    expect((await screen.findByText(/Undone: 100 put back, 20 removed/))).toBeTruthy();
  });

  it('warns when the file looks older than what is stored, and refuses a file with nothing to import', async () => {
    api.previewLeadsFile.mockResolvedValue({ ...preview, added: 0, refreshed: 0, unchanged: 50, older: 40 });
    render(<LeadImportModal onClose={() => {}} onDone={() => {}} />);
    pick();
    expect(await screen.findByText(/looks/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(/nothing to import/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /Import 120 projects/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the reason when the file is refused', async () => {
    api.previewLeadsFile.mockRejectedValue(new Error('This isn\'t the ConstructConnect export: no column called “Project Id”.'));
    render(<LeadImportModal onClose={() => {}} onDone={() => {}} />);
    pick();
    expect((await screen.findByRole('alert')).textContent).toContain('isn\'t the ConstructConnect export');
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Undo last import asks first, then puts the latest import back', async () => {
    api.undoLeadsImport.mockResolvedValue({ restored: 4, removed: 1, kept: 2 });
    render(<ProjectLeadsPage currentUser={{ name: 'Sam' }} />);
    await screen.findByText('Lulac Hacienda Apartments');
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Undo last import/ }));
    expect(await screen.findByText(/Only the latest import can be undone/)).toBeTruthy();
    expect(api.undoLeadsImport).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Undo import' }));
    await waitFor(() => expect(api.undoLeadsImport).toHaveBeenCalledWith('imp1'));
    expect(await screen.findByText('The import is undone.', { exact: false })).toBeTruthy();
  });
});
