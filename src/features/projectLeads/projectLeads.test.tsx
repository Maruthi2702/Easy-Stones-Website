// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ProjectLeadsPage from './ProjectLeadsPage';
import LeadImportModal from './LeadImportModal';
import type { Lead } from '../../api/projectLeads';
import type { CompanyDetail, CompanyItem } from '../../utils/projectLeadCompanies';

const api = vi.hoisted(() => ({
  leadsMeta: vi.fn(), listLeads: vi.fn(), exportLeads: vi.fn(), updateLead: vi.fn(), importLeadsFile: vi.fn(), previewLeadsFile: vi.fn(), undoLeadsImport: vi.fn(),
  listCompanies: vi.fn(), exportCompanies: vi.fn(), getCompanyDetail: vi.fn(), updateCompanyWork: vi.fn(), getLead: vi.fn()
}));
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
  status: 'new', assignedTo: '', assignedToId: '', canTake: true, canRelease: false, note: '', statusBy: '', statusAt: '', history: [],
  companies: [
    { companyId: '1', name: 'Acme Owners', role: 'Owner', group: 'owner', address: '', city: 'Austin', state: 'Texas', zip: '', firstName: 'Ann', lastName: 'Lee', phone: '2065551234', email: 'ann@acme.test' },
    { companyId: '2', name: 'Eng Co', role: 'Civil Engineer', group: 'other', address: '', city: '', state: '', zip: '', firstName: '', lastName: '', phone: '', email: '' }
  ]
};

const company: CompanyItem = {
  key: '501', name: 'Rainier Builders', roles: ['contractor', 'owner'], projects: 3, lastUpdated: '2026-06-01', topValue: 20_000_000, latestProject: 'Lulac Hacienda Apartments',
  contact: { firstName: 'Ann', lastName: 'Lee', phone: '2065551234', email: 'ann@rainier.test' }, address: '1 Main', city: 'Tacoma', state: 'WA', zip: '98402',
  status: 'new', assignedTo: '', assignedToId: '', note: '', statusBy: '', statusAt: '', canTake: true, canRelease: false
};
const companyDetail: CompanyDetail = {
  ...company, history: [],
  people: [{ ...company.contact, roles: ['General Contractor'], projects: 3, latest: { id: '1001', title: 'Lulac Hacienda Apartments', city: 'Austin', state: 'Texas' } }],
  projectList: [{ id: '1001', title: 'Lulac Hacienda Apartments', city: 'Austin', state: 'Texas', value: 4_500_000, stage: 'Post Bid', subcategory: 'Apartments', units: 60, updatedOn: '2026-06-01', roles: ['General Contractor'] }]
};
/** The page opens on Companies; most of these tests are about the Projects list. */
const showProjects = async () => { fireEvent.click(await screen.findByRole('tab', { name: 'Projects' })); };

beforeEach(() => {
  vi.clearAllMocks();
  api.listCompanies.mockResolvedValue({ items: [company], counts: { new: 1 }, total: 1, roleCounts: { all: 1, contractor: 1, owner: 1 } });
  api.getCompanyDetail.mockResolvedValue(companyDetail);
  api.updateCompanyWork.mockImplementation(async (_key: string, change: Record<string, unknown>) => ({ ...companyDetail, ...change }));
  api.getLead.mockResolvedValue(lead);
  api.leadsMeta.mockResolvedValue(meta);
  api.listLeads.mockResolvedValue({ items: [lead], counts: { new: 1 }, total: 1 });
  api.updateLead.mockImplementation(async (_id: string, change: Record<string, unknown>) => ({ ...lead, ...change }));
});
afterEach(cleanup);

describe('Multifamily Leads → Companies', () => {
  it('opens on companies: one row each with its roles, projects and the person to call', async () => {
    render(<ProjectLeadsPage currentUser={{ name: 'Sam' }} />);
    expect(await screen.findByText('Rainier Builders')).toBeTruthy();
    expect(api.listCompanies).toHaveBeenCalledWith(expect.objectContaining({ page: 1, sort: 'updated_desc' }));
    expect(api.listLeads).not.toHaveBeenCalled();
    expect(screen.getByText(/Contractor · Owner \/ developer · Tacoma, WA/)).toBeTruthy();
    expect(screen.getByText(/3 projects · latest: Lulac Hacienda Apartments/)).toBeTruthy();
    expect(screen.getByText('Ann Lee')).toBeTruthy();
    // Call and Email are one tap away, outside the row's own button.
    expect(screen.getByRole('link', { name: 'Call Rainier Builders' }).getAttribute('href')).toBe('tel:2065551234');
    expect(screen.getByRole('link', { name: 'Email Rainier Builders' }).getAttribute('href')).toBe('mailto:ann@rainier.test');
  });

  it('has a tab per role with its count, and a tab asks only for that role', async () => {
    render(<ProjectLeadsPage />);
    await screen.findByText('Rainier Builders');
    expect(screen.getAllByRole('tab', { name: /All/ }).length).toBe(2);   // all roles, and all statuses
    expect(screen.getByRole('tablist', { name: 'Companies by role' })).toBeTruthy();
    for (const name of ['Contractors', 'Architects', 'Interior designers', 'Owners & developers']) expect(screen.getByRole('tab', { name: new RegExp(name) })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Architects/ }));
    await waitFor(() => expect(api.listCompanies).toHaveBeenLastCalledWith(expect.objectContaining({ role: 'architect' })));
  });

  it('opens a company: its people, its projects, and saves its own status and note', async () => {
    const onCreateCustomer = vi.fn();
    render(<ProjectLeadsPage currentUser={{ name: 'Sam' }} onCreateCustomer={onCreateCustomer} />);
    fireEvent.click(await screen.findByText('Rainier Builders'));
    const dialog = await screen.findByRole('dialog', { name: 'Rainier Builders' });
    expect(await screen.findByText('Who to contact', { exact: false })).toBeTruthy();
    expect(dialog.querySelector('a[href="tel:2065551234"]')).toBeTruthy();
    expect(dialog.textContent).toContain('Lulac Hacienda Apartments');
    fireEvent.click(screen.getByRole('button', { name: 'Samples sent' }));
    await waitFor(() => expect(api.updateCompanyWork).toHaveBeenCalledWith('501', { status: 'samples' }));
    fireEvent.click(screen.getByRole('button', { name: 'Take this lead' }));
    await waitFor(() => expect(api.updateCompanyWork).toHaveBeenCalledWith('501', { assignedTo: 'me' }));
    fireEvent.click(screen.getByRole('button', { name: /Create customer/ }));
    expect(onCreateCustomer).toHaveBeenCalledWith(expect.objectContaining({ company: 'Rainier Builders', phone: '(206) 555-1234', customerType: 'Contractor' }));
  });

  it('opens one of its projects, and the Projects switch brings back the list by project', async () => {
    render(<ProjectLeadsPage />);
    fireEvent.click(await screen.findByText('Rainier Builders'));
    const drawer = await screen.findByRole('dialog', { name: 'Rainier Builders' });
    fireEvent.click(await within(drawer).findByRole('button', { name: /Lulac Hacienda Apartments/ }));
    await waitFor(() => expect(api.getLead).toHaveBeenCalledWith('1001'));
    expect(await screen.findByRole('dialog', { name: 'Lulac Hacienda Apartments' })).toBeTruthy();
    cleanup();
    render(<ProjectLeadsPage />);
    await showProjects();
    expect(await screen.findByText('Lulac Hacienda Apartments')).toBeTruthy();
    expect(api.listLeads).toHaveBeenCalled();
  });

  it('says so when nothing matches', async () => {
    api.listCompanies.mockResolvedValue({ items: [], counts: {}, total: 0, roleCounts: { all: 0 } });
    render(<ProjectLeadsPage />);
    expect(await screen.findByRole('heading', { name: 'No companies match' })).toBeTruthy();
  });
});

describe('Multifamily Leads page', () => {
  it('lists projects with the people to call and opens one with a way to phone or email them', async () => {
    render(<ProjectLeadsPage currentUser={{ name: 'Sam' }} />);
    await showProjects();
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
    await showProjects();
    fireEvent.click(await screen.findByText('Lulac Hacienda Apartments'));
    fireEvent.click(await screen.findByRole('button', { name: 'Samples sent' }));
    await waitFor(() => expect(api.updateLead).toHaveBeenCalledWith('1001', { status: 'samples' }));
    fireEvent.click(screen.getByRole('button', { name: 'Take this lead' }));
    await waitFor(() => expect(api.updateLead).toHaveBeenCalledWith('1001', { assignedTo: 'me' }));   // the server takes it for the caller
  });

  it('makes a customer from a company, prefilled', async () => {
    const onCreateCustomer = vi.fn();
    render(<ProjectLeadsPage currentUser={{ name: 'Sam' }} onCreateCustomer={onCreateCustomer} />);
    await showProjects();
    fireEvent.click(await screen.findByText('Lulac Hacienda Apartments'));
    fireEvent.click((await screen.findAllByRole('button', { name: /Create customer/ }))[0]);
    expect(onCreateCustomer).toHaveBeenCalledWith(expect.objectContaining({ company: 'Acme Owners', customerType: 'Builder', phone: '(206) 555-1234', email: 'ann@acme.test' }));
  });

  it('filters by status tab and shows the empty state with an import hint', async () => {
    api.listLeads.mockResolvedValue({ items: [], counts: {}, total: 0 });
    api.leadsMeta.mockResolvedValue({ ...meta, total: 0, lastImport: null });
    render(<ProjectLeadsPage />);
    await showProjects();
    expect(await screen.findByRole('heading', { name: 'No multifamily leads yet' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Contacted/ }));
    await waitFor(() => expect(api.listLeads).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'contacted' })));
  });

  it('hides Import and Export without those switches, and shows a load error with Retry', async () => {
    api.leadsMeta.mockResolvedValue({ ...meta, canImport: false, canExport: false, canEdit: false });
    api.listLeads.mockRejectedValueOnce(new Error('Leads unavailable'));
    render(<ProjectLeadsPage />);
    await showProjects();
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

describe('Who a lead is with', () => {
  const withSam = { ...lead, assignedTo: 'Sam', assignedToId: 'u-sam', canTake: false };
  const open = async (l: Lead) => {
    api.listLeads.mockResolvedValue({ items: [l], counts: { new: 1 }, total: 1 });
    render(<ProjectLeadsPage currentUser={{ name: 'Priya' }} />);
    await showProjects();
    fireEvent.click(await screen.findByText('Lulac Hacienda Apartments'));
    return screen.findByRole('dialog', { name: 'Lulac Hacienda Apartments' });
  };

  it('says it first, in a callout, and offers Release to the person it is with or their manager', async () => {
    const dialog = await open({ ...withSam, canRelease: true });
    expect(dialog.querySelector('.prj-assign.has')?.textContent).toContain('Lead is with');
    expect(dialog.querySelector('.prj-assign strong')?.textContent).toBe('Sam');
    fireEvent.click(screen.getByRole('button', { name: 'Release' }));
    await waitFor(() => expect(api.updateLead).toHaveBeenCalledWith('1001', { assignedTo: '' }));
    // Once it is free the same panel offers it to be taken.
    expect(await screen.findByRole('button', { name: 'Take this lead' })).toBeTruthy();
  });

  it('shows nobody else a Release or Take button, and says who can release', async () => {
    const dialog = await open({ ...withSam, canRelease: false });
    expect(screen.queryByRole('button', { name: 'Release' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Take this lead' })).toBeNull();
    expect(dialog.textContent).toContain('Only Sam or their manager can release this lead.');
  });

  it('writes a take or release in the history as words, not a status', async () => {
    const dialog = await open({ ...withSam, canRelease: true, history: [{ at: '2026-11-20T10:00:00.000Z', by: 'Sam', status: 'new', note: '', event: 'Took this lead' }] });
    expect(dialog.querySelector('.prj-event')?.textContent).toBe('Took this lead');
  });
});

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
    await showProjects();
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

const phone = (on: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (q: string) => ({ matches: on && q.includes('max-width: 639px'), media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false, onchange: null })
  });
};

describe('Filters on each screen size', () => {
  afterEach(() => { phone(false); document.body.removeAttribute('style'); });

  it('is a floating panel on a laptop, closed by Done', async () => {
    phone(false);
    render(<ProjectLeadsPage />);
    await showProjects();
    await screen.findByText('Lulac Hacienda Apartments');
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    const panel = await screen.findByRole('dialog', { name: 'Filters' });
    expect(panel.className).toContain('prj-pop');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog', { name: 'Filters' })).toBeNull();
  });

  it('is a bottom sheet on a phone: shows the live count, applies a filter, survives taps inside it, and closes on the backdrop', async () => {
    phone(true);
    api.listLeads.mockResolvedValue({ items: [lead], counts: { new: 1 }, total: 312 });
    render(<ProjectLeadsPage />);
    await showProjects();
    await screen.findByText('Lulac Hacienda Apartments');
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    const sheet = await screen.findByRole('dialog', { name: 'Filters' });
    expect(sheet.className).toContain('prj-sheet');
    expect(document.body.style.position).toBe('fixed');                       // the page is locked behind it
    expect(screen.getByRole('button', { name: 'Show 312 projects' })).toBeTruthy();
    // A tap inside the sheet must not count as "outside" and close it.
    fireEvent.mouseDown(screen.getByText('Filters'));
    fireEvent.touchStart(screen.getByText('Filters'));
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeTruthy();
    // States is one dropdown that ticks several.
    fireEvent.click(screen.getByRole('button', { name: /State.*All states/ }));
    fireEvent.click(screen.getByLabelText(/Texas/));
    await waitFor(() => expect(api.listLeads).toHaveBeenLastCalledWith(expect.objectContaining({ states: 'Texas' })));
    expect(screen.getByRole('button', { name: /State.*Texas/ })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Clear' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Close filters' }));
    expect(screen.queryByRole('dialog', { name: 'Filters' })).toBeNull();
    expect(document.body.style.position).toBe('');                            // and the page is released
  });

  it('closes the phone sheet with Escape', async () => {
    phone(true);
    render(<ProjectLeadsPage />);
    await showProjects();
    await screen.findByText('Lulac Hacienda Apartments');
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    await screen.findByRole('dialog', { name: 'Filters' });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Filters' })).toBeNull();
  });
});

describe('State dropdown', () => {
  it('ticks several states, says them on the closed field, and All / None set them in one go', async () => {
    api.leadsMeta.mockResolvedValue({ ...meta, states: [{ name: 'Texas', count: 3 }, { name: 'Oregon', count: 2 }, { name: 'Utah', count: 1 }] });
    render(<ProjectLeadsPage />);
    await showProjects();
    await screen.findByText('Lulac Hacienda Apartments');
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    const trigger = await screen.findByRole('button', { name: /State.*All states/ });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    fireEvent.click(screen.getByLabelText(/Texas/));
    fireEvent.click(screen.getByLabelText(/Oregon/));
    await waitFor(() => expect(api.listLeads).toHaveBeenLastCalledWith(expect.objectContaining({ states: 'Texas,Oregon' })));
    expect(screen.getByRole('button', { name: /State.*Texas \+ Oregon/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByRole('button', { name: /State.*3 states/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'None' }));
    await waitFor(() => expect(api.listLeads).toHaveBeenLastCalledWith(expect.objectContaining({ states: '' })));
  });
});
