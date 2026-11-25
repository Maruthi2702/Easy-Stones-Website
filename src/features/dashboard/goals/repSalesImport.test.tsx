// @vitest-environment jsdom
// Goals → Import sales: the SPS "Sales by Primary Sales Rep - Monthly" file is read here, checked by the
// server, a name that matches nobody can be matched to a staff member, and Import sends the picks.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import * as XLSX from 'xlsx';

const net = vi.hoisted(() => ({ calls: [] as { url: string; body: Record<string, unknown> }[], unmatched: [] as { name: string; key: string; cents: number }[], refuse: '' }));
vi.mock('../../../api/authFetch', () => ({
  authFetch: (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || '{}'));
    net.calls.push({ url, body });
    if (net.refuse) return Promise.resolve(new Response(JSON.stringify({ message: net.refuse }), { status: 400 }));
    if (url.endsWith('/sales/preview')) {
      return Promise.resolve(new Response(JSON.stringify({
        year: 2026, reps: 3, totalCents: 8_533_859_347, noRepCents: 206_159,
        matched: [{ name: 'Krish', key: 'krish', cents: 100, userId: 'a1', userName: 'Krish' }],
        unmatched: net.unmatched, earlier: { importedAt: '2026-11-01T10:00:00Z', reps: 60 }
      })));
    }
    return Promise.resolve(new Response(JSON.stringify({ year: 2026, reps: 3, rows: 5, linked: Object.keys(body.links as object).length, totalCents: 8_533_859_347, matched: 2, unmatched: [{ name: 'Ex Employee', cents: -2000 }] })));
  }
}));
vi.mock('../../../api/salesRepOptions', () => ({
  useStaffList: () => [
    { _id: 'a1', username: 'krish', displayName: 'Krish', role: 'admin', location: 'Seattle', isActive: true },
    { _id: 'a2', username: 'maria', displayName: 'Maria R', role: 'sales_rep', location: 'Seattle', isActive: true },
    { _id: 'a3', username: 'drv', displayName: 'Dee Driver', role: 'driver', location: 'Seattle', isActive: true }
  ]
}));

const RepSalesImportModal = (await import('./RepSalesImportModal')).default;

const workbook = () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Sales Person', 'Jan 26', 'Feb 26', 'Mar 26', 'Apr 26', 'May 26', 'Jun 26', 'Jul 26', 'Aug 26', 'Sep 26', 'Oct 26', 'Nov 26', 'Dec 26', 'Total'],
    ['Krish', 1, '', '', '', '', '', '', '', '', '', '', '', 1]
  ]), 'Sheet 1');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Exported On:', '2026-11-25 16:01:02 CST'], ['Exported By:', 'Sankeerth']]), 'Metadata');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
};
const choose = (bytes: Uint8Array) => {
  const file = new File([bytes as unknown as BlobPart], 'rep.xlsx');
  Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.resolve(bytes.buffer) });   // jsdom's File has none
  fireEvent.change(screen.getByLabelText('Sales by rep file'), { target: { files: [file] } });
};

beforeEach(() => { net.calls = []; net.unmatched = []; net.refuse = ''; });
afterEach(cleanup);

describe('Import sales by rep', () => {
  it('reads the file, shows the check, and imports straight away when every name matches', async () => {
    const onDone = vi.fn(); const onClose = vi.fn();
    render(<RepSalesImportModal onClose={onClose} onDone={onDone} />);
    choose(workbook());
    const check = await screen.findByRole('list', { name: 'File check' });
    expect(within(check).getByText(/sales people read for/i)).toBeTruthy();
    expect(within(check).getByText(/credited to no sales person/i)).toBeTruthy();
    expect(within(check).getByText(/was imported before/i)).toBeTruthy();
    // the preview is sent the sheet's rows (header first), never the Metadata sheet
    expect((net.calls[0].body.rows as unknown[][])[0][0]).toBe('Sales Person');
    fireEvent.click(screen.getByRole('button', { name: 'Import 2026' }));
    await screen.findByText('✓ The Goals view now compares each rep’s goals with these figures.');
    const sent = net.calls.find((c) => c.url.endsWith('/sales/import'))!.body;
    expect(sent).toMatchObject({ fileName: 'rep.xlsx', exportedOn: '2026-11-25 16:01:02 CST', links: {} });
    expect(onDone).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('a name that matches nobody is offered a staff picker, a pick is sent as a link, and a name left alone is not', async () => {
    net.unmatched = [{ name: 'Pat Nobody', key: 'pat nobody', cents: 70_000 }, { name: 'Ex Employee', key: 'ex employee', cents: -2000 }];
    render(<RepSalesImportModal onClose={() => {}} onDone={() => {}} />);
    choose(workbook());
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(/aren’t any staff member’s Display Name/)).toBeTruthy();
    expect(screen.getByText('Pat Nobody')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: /Not counted/ })[0]);
    fireEvent.click(await screen.findByText('Maria R'));
    expect(screen.getByText('1 matched so far.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Import 2026' }));
    await waitFor(() => expect(net.calls.some((c) => c.url.endsWith('/sales/import'))).toBe(true));
    expect(net.calls.find((c) => c.url.endsWith('/sales/import'))!.body.links).toEqual({ 'pat nobody': 'a2' });   // a driver is never offered
  });

  it('says why when the server refuses the file, and offers no way to import it', async () => {
    net.refuse = 'No "Sales Person" column was found. Use the report "Sales by Primary Sales Rep - Monthly".';
    render(<RepSalesImportModal onClose={() => {}} onDone={() => {}} />);
    choose(workbook());
    expect((await screen.findByRole('alert')).textContent).toMatch(/No "Sales Person" column/);
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
