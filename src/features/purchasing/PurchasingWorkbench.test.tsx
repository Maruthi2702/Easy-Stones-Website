// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { clearInventoryCache } from '../../api/inventoryAnalysisCache';
import { setAuthToken, clearAuthToken } from '../../api/authToken';
import { project } from '../../purchasing/planning';
import type { Plan, Metadata } from '../../purchasing/types';
vi.mock('./purchasingApi', () => ({
  purchasingApi: {
    metadata: vi.fn(),
    plan: vi.fn(),
    drafts: vi.fn(),
    inbound: vi.fn(),
    saveScope: vi.fn(),
    importInbound: vi.fn(),
    createDraft: vi.fn(),
    action: vi.fn(),
    checkedExport: vi.fn(),
  },
  exportPlan: vi.fn(),
  download: vi.fn(),
  csv: vi.fn(),
}));
const { purchasingApi } = await import('./purchasingApi');
const { default: PurchasingWorkbench } = await import('./PurchasingWorkbench');
const scope = {
  _id: 'scope',
  __v: 0,
  name: 'Seattle buying',
  branches: ['Seattle'],
  cohortId: 'cohort',
  observedThrough: '2026-10-24',
  fullSalesCoverage: false,
  stockSnapshotId: 'stock',
  stockCoverageConfirmed: false,
  freeStockValidated: false,
  policyConfirmed: false,
  reviewDays: 7,
  bufferDays: 21,
  stockMaxHours: 24,
  salesMaxDays: 14,
  aliases: [],
  policies: [],
  container: { payloadKg: 0, tareKg: 0, maxSlabs: 0, layoutConfirmed: false, mixingConfirmed: false },
};
const plan: Plan = {
  scope,
  fingerprint: 'snapshot',
  today: '2026-10-24',
  generatedAt: '2026-10-24T20:00:00Z',
  cohort: {
    id: 'cohort',
    location: 'Seattle',
    start: '2026-01-01',
    end: '2026-10-31',
    importedAt: '2026-10-24T20:00:00Z',
    count: 1,
  },
  stockSnapshotId: 'stock',
  stockImportedAt: '2026-10-19T20:00:00Z',
  inboundImportedAt: null,
  blockers: ['Confirm source coverage'],
  draftIds: [],
  rows: [
    {
      key: 'quartz::SF',
      product: 'Quartz 3CM',
      uom: 'SF',
      sold: 120,
      soldSlabs: 2,
      readySlabs: null,
      readyQuantity: null,
      excludedSlabs: 0,
      hasStock: false,
      blockers: ['Confirm source coverage', 'No variant policy'],
      policy: null,
      baseline: null,
      protective: null,
      action: 'Resolve inputs',
    },
  ],
};
const metadata: Metadata = {
  branches: ['Seattle'],
  cohorts: [plan.cohort!],
  scopes: [scope],
  stockSnapshotId: 'stock',
  stockImportedAt: plan.stockImportedAt,
};
beforeEach(() => {
  clearInventoryCache();
  vi.mocked(purchasingApi.metadata).mockResolvedValue(metadata);
  vi.mocked(purchasingApi.plan).mockResolvedValue(plan);
  vi.mocked(purchasingApi.drafts).mockResolvedValue([]);
  vi.mocked(purchasingApi.inbound).mockResolvedValue(null);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});
describe('purchasing workbench rendering', () => {
  it('keeps buyer notes through background refresh and submits the opened input version', async () => {
    const policy = {
      product: 'Quartz 3CM',
      supplier: 'ABC',
      bundleSlabs: 6,
      minimumSlabs: 0,
      sfPerSlab: 1,
      weightKg: 400,
      mixGroup: '',
      active: true,
    };
    const protective = project({
      daily: 1,
      ready: 0,
      receipts: [],
      policy,
      today: '2026-10-24',
      leadDays: 90,
      reviewDays: 7,
      bufferDays: 21,
    });
    const ready = {
      ...plan,
      blockers: [],
      rows: [
        {
          ...plan.rows[0]!,
          blockers: [],
          policy,
          baseline: protective,
          protective,
          action: 'Draft container buy',
        },
      ],
    };
    vi.mocked(purchasingApi.plan)
      .mockResolvedValueOnce(ready)
      .mockResolvedValue({ ...ready, fingerprint: 'changed-inputs' });
    vi.mocked(purchasingApi.createDraft).mockRejectedValue(new Error('Planning inputs changed'));
    render(<PurchasingWorkbench currentUser={{ permissions: ['view_purchasing', 'manage_purchasing'] }} />);
    await screen.findByRole('button', { name: 'Quartz 3CM' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Quartz 3CM' }));
    fireEvent.click(screen.getByRole('button', { name: 'Draft 1 selected variants' }));
    const note = screen.getByLabelText('Buyer note / quantity override reason');
    fireEvent.change(note, { target: { value: 'Keep this buyer reasoning' } });
    fireEvent.click(screen.getByRole('button', { name: /^Refresh$/ }));
    await waitFor(() => expect(purchasingApi.plan).toHaveBeenCalledTimes(2));
    expect(
      (screen.getByLabelText('Buyer note / quantity override reason') as HTMLTextAreaElement).value,
    ).toBe('Keep this buyer reasoning');
    fireEvent.click(screen.getByRole('button', { name: 'Calculate loads & save draft' }));
    await screen.findByText('Planning inputs changed');
    expect(purchasingApi.createDraft).toHaveBeenCalledWith(
      'scope',
      expect.objectContaining({ fingerprint: 'snapshot', note: 'Keep this buyer reasoning' }),
    );
  });

  it('shows imported PO/container quantities while a planning validation blocks recommendations', async () => {
    vi.mocked(purchasingApi.plan).mockResolvedValue({ ...plan, transitLineCount: 1, transitImportedAt: '2026-10-25T20:00:00Z',
      rows: [{ ...plan.rows[0], transit: [{ key: 'sps-1', poNumber: '15364', containerNumber: 'TEMU1379996',
        siplNumber: '15364', product: 'Quartz 3CM', branch: 'Seattle', supplier: 'ABC', slabs: 24, quantity: 1800,
        units: 'SF', eta: '2026-11-24', importedAt: '2026-10-25T20:00:00Z' }] }] });
    render(<PurchasingWorkbench currentUser={{ permissions: ['view_purchasing'] }} />);
    await screen.findByRole('columnheader', { name: 'In-transit containers' });
    expect(screen.getByText('24 slabs')).toBeTruthy();
    expect(screen.getByText(/Reading 1 imported in-transit product lines/)).toBeTruthy();
    expect(screen.getByText('PO #15364 · TEMU1379996')).toBeTruthy();
    expect(screen.getAllByText('Resolve inputs').length).toBeGreaterThan(0);
  });
  it('shows actual blockers and unknown availability without offering a buy quantity', async () => {
    render(<PurchasingWorkbench currentUser={{ permissions: ['view_purchasing'] }} />);
    await screen.findByRole('button', { name: 'Quartz 3CM' });
    expect(screen.getByRole('checkbox', { name: 'Select Quartz 3CM' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getAllByText('Confirm source coverage').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'New planning scope' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Quartz 3CM' }));
    expect(await screen.findByText('Quantity is blocked')).toBeTruthy();
    expect(screen.getByText('Unresolved; not assumed zero')).toBeTruthy();
  });
  it('offers scope and SPS supply configuration only to a purchasing editor', async () => {
    render(<PurchasingWorkbench currentUser={{ permissions: ['view_purchasing', 'manage_purchasing'] }} />);
    await screen.findByRole('button', { name: 'Import SPS PO / transit' });
    fireEvent.click(screen.getByRole('button', { name: 'Import SPS PO / transit' }));
    expect(await screen.findByRole('heading', { name: 'Import SPS open POs & transit' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Save complete supply snapshot' }).hasAttribute('disabled'),
    ).toBe(true);
    expect(screen.getByText(/This import does not connect to SPS automatically/)).toBeTruthy();
  });
  it('shows a setup state when reports exist but no scope has been validated', async () => {
    vi.mocked(purchasingApi.metadata).mockResolvedValue({ ...metadata, scopes: [] });
    render(<PurchasingWorkbench currentUser={{ permissions: ['manage_purchasing'] }} />);
    await screen.findByText('Start with a verified planning scope');
    fireEvent.click(screen.getByRole('button', { name: 'New planning scope' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'New purchasing scope' })).toBeTruthy());
    expect(screen.getByText(/not only top sellers/)).toBeTruthy();
  });
  it('does not invent 30/90/180-day trends from one aggregate cohort', async () => {
    render(<PurchasingWorkbench currentUser={{ permissions: ['view_purchasing'] }} />);
    await screen.findByRole('button', { name: 'Quartz 3CM' });
    fireEvent.click(screen.getByRole('button', { name: 'Color performance' }));
    expect(screen.getByText(/30\/90\/180-day trend and statistical XYZ are unavailable/)).toBeTruthy();
  });
});


describe('purchasing tab return', () => {
  const user = { permissions: ['view_purchasing'] };
  it('renders recent results on return without repeating four requests or flashing a loader', async () => {
    const first = render(<PurchasingWorkbench currentUser={user} />);
    await screen.findByRole('button', { name: 'Quartz 3CM' });
    first.unmount();
    render(<PurchasingWorkbench currentUser={user} />);
    expect(screen.getByRole('button', { name: 'Quartz 3CM' })).toBeTruthy();
    expect(screen.queryByText('Loading purchasing inputs…')).toBeNull();
    await waitFor(() => expect(purchasingApi.metadata).toHaveBeenCalledTimes(1));
    expect(purchasingApi.plan).toHaveBeenCalledTimes(1);
    expect(purchasingApi.drafts).toHaveBeenCalledTimes(1);
    expect(purchasingApi.inbound).toHaveBeenCalledTimes(1);
  });
  it('retains the selected scope across tab unmounts', async () => {
    const secondScope = { ...scope, _id: 'second', name: 'Second scope' };
    vi.mocked(purchasingApi.metadata).mockResolvedValue({ ...metadata, scopes: [scope, secondScope] });
    vi.mocked(purchasingApi.plan).mockImplementation(async id => ({ ...plan, scope: id === 'second' ? secondScope : scope }));
    const first = render(<PurchasingWorkbench currentUser={user} />);
    await screen.findByRole('button', { name: 'Quartz 3CM' });
    fireEvent.change(screen.getByLabelText('Planning scope'), { target: { value: 'second' } });
    await waitFor(() => expect(purchasingApi.plan).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('Loading purchasing inputs…')).toBeNull());
    first.unmount();
    render(<PurchasingWorkbench currentUser={user} />);
    expect((screen.getByLabelText('Planning scope') as HTMLSelectElement).value).toBe('second');
    expect(screen.getByRole('button', { name: 'Quartz 3CM' })).toBeTruthy();
    expect(purchasingApi.plan).toHaveBeenCalledTimes(2);
  });
  it('bypasses remembered results on explicit Refresh and inventory announcements', async () => {
    const view = render(<PurchasingWorkbench currentUser={user} />);
    await screen.findByRole('button', { name: 'Quartz 3CM' });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(purchasingApi.plan).toHaveBeenCalledTimes(2));
    view.rerender(<PurchasingWorkbench currentUser={user} refreshSignal={1} />);
    await waitFor(() => expect(purchasingApi.plan).toHaveBeenCalledTimes(3));
    expect(purchasingApi.metadata).toHaveBeenCalledTimes(3);
  });
  it('reloads after an import clears inventory caches while the tab is closed', async () => {
    const first = render(<PurchasingWorkbench currentUser={user} />);
    await screen.findByRole('button', { name: 'Quartz 3CM' });
    first.unmount();
    clearInventoryCache();
    render(<PurchasingWorkbench currentUser={user} />);
    await waitFor(() => expect(purchasingApi.plan).toHaveBeenCalledTimes(2));
    expect(purchasingApi.metadata).toHaveBeenCalledTimes(2);
  });
  it('expires remembered answers after 30 seconds', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const first = render(<PurchasingWorkbench currentUser={user} />);
    await screen.findByRole('button', { name: 'Quartz 3CM' });
    first.unmount();
    clock.mockReturnValue(now + 30001);
    render(<PurchasingWorkbench currentUser={user} />);
    await waitFor(() => expect(purchasingApi.plan).toHaveBeenCalledTimes(2));
    expect(purchasingApi.metadata).toHaveBeenCalledTimes(2);
  });
  it("does not reuse another signed-in session's data", async () => {
    setAuthToken('first-session');
    const first = render(<PurchasingWorkbench currentUser={user} />);
    await screen.findByRole('button', { name: 'Quartz 3CM' });
    first.unmount();
    clearAuthToken();
    setAuthToken('second-session');
    render(<PurchasingWorkbench currentUser={user} />);
    await waitFor(() => expect(purchasingApi.plan).toHaveBeenCalledTimes(2));
    expect(purchasingApi.metadata).toHaveBeenCalledTimes(2);
    clearAuthToken();
  });
});
