import type { ReactNode, FormEventHandler } from 'react';
// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import IncomingTransferForm from './IncomingTransferForm';
vi.mock('../../../components/shared/calendar/Calendar', () => ({ DatePicker: ({ id, value, onChange }: { id?: string; value: string; onChange: (value: string) => void }) => <input id={id} value={value} onChange={e => onChange(e.target.value)} /> }));
vi.mock('../../../components/shared/form/FormModal', () => ({ default: ({ children, onSubmit, submitDisabled }: { children: ReactNode; onSubmit: FormEventHandler<HTMLFormElement>; submitDisabled?: boolean }) => <form onSubmit={onSubmit}>{children}<button disabled={submitDisabled}>Save changes</button></form> }));
afterEach(cleanup);
const ticket = { id: 't1', deliveryType: 'transfer', location: 'Spokane', transferDestination: 'Seattle', date: '2026-10-31', expectedArrivalDate: '2026-11-02', numberOfSlabs: 3, customerName: 'Example' };
describe('receiving transfer form', () => {
  it('sends only the fields changed by the receiving branch', async () => {
    const onSave = vi.fn(async () => {}), onClose = vi.fn();
    render(<IncomingTransferForm ticket={ticket} onSave={onSave} onClose={onClose} />);
    expect(screen.queryByLabelText('Driver')).toBeNull(); expect(screen.queryByLabelText('Ship date')).toBeNull();
    fireEvent.change(screen.getByLabelText(/Slab count/), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith('t1', { numberOfSlabs: 8 });
  });
  it('keeps the form open on a server error', async () => {
    const onClose = vi.fn();
    render(<IncomingTransferForm ticket={ticket} onClose={onClose} onSave={async () => { throw Error('Try again'); }} />);
    fireEvent.change(screen.getByLabelText(/Slab count/), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Try again');
    expect(onClose).not.toHaveBeenCalled();
  });
  it('marks it received and says so', async () => {
    const onMarkReceived = vi.fn(async () => ({ ...ticket, receivedAt: '2026-11-02T18:00:00Z', receivedBy: 'Dee' }));
    render(<IncomingTransferForm ticket={ticket} onClose={vi.fn()} onMarkReceived={onMarkReceived} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark received' }));
    expect((await screen.findByText(/^Received/)).textContent).toMatch(/by Dee/);
    expect(onMarkReceived).toHaveBeenCalledWith('t1');
  });
  it('shows a transfer already received, with no button', () => {
    render(<IncomingTransferForm ticket={{ ...ticket, receivedAt: '2026-11-02T18:00:00Z', receivedBy: 'Dee' }} onClose={vi.fn()} onMarkReceived={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Mark received' })).toBeNull();
    expect(screen.getByText(/^Received/).textContent).toMatch(/by Dee/);
  });
  it('sends a status change the receiving branch may make', async () => {
    const onSave = vi.fn(async () => {}), onClose = vi.fn();
    render(<IncomingTransferForm ticket={{ ...ticket, truckId: 'drv_x', status: 'scheduled' }} onSave={onSave} onClose={onClose} />);
    fireEvent.click(document.getElementById('incoming-status')!);
    expect(screen.getByRole('option', { name: /Cancelled/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Pending/ })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: /Delayed/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith('t1', { status: 'delayed' });
  });
  it('locks the status until the sender puts it on a truck', () => {
    render(<IncomingTransferForm ticket={{ ...ticket, truckId: '', status: 'pending' }} onClose={vi.fn()} />);
    expect((document.getElementById('incoming-status') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/hasn’t put it on a truck/)).toBeTruthy();
  });
  it('says what Completed and Cancelled also do', () => {
    render(<IncomingTransferForm ticket={{ ...ticket, truckId: 'drv_x', status: 'scheduled' }} onClose={vi.fn()} />);
    fireEvent.click(document.getElementById('incoming-status')!);
    fireEvent.click(screen.getByRole('option', { name: /Completed/ }));
    expect(screen.getByText('Also marks it received.')).toBeTruthy();
    fireEvent.click(document.getElementById('incoming-status')!);
    fireEvent.click(screen.getByRole('option', { name: /Cancelled/ }));
    expect(screen.getByText('Only Spokane can restore it once cancelled.')).toBeTruthy();
  });
  it('shows Completed once Mark received completes it', async () => {
    const onMarkReceived = vi.fn(async () => ({ ...ticket, truckId: 'drv_x', status: 'completed', receivedAt: '2026-11-02T18:00:00Z', receivedBy: 'Dee' }));
    render(<IncomingTransferForm ticket={{ ...ticket, truckId: 'drv_x', status: 'scheduled' }} onClose={vi.fn()} onMarkReceived={onMarkReceived} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark received' }));
    await screen.findByText(/^Received/);
    expect(document.getElementById('incoming-status')!.textContent).toMatch(/Completed/);
    expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
