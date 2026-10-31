// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import IncomingTransferForm from './IncomingTransferForm';
vi.mock('../../../components/shared/calendar/Calendar', () => ({ DatePicker: ({ id, value, onChange }: any) => <input id={id} value={value} onChange={e => onChange(e.target.value)} /> }));
vi.mock('../../../components/shared/form/FormModal', () => ({ default: ({ children, onSubmit, submitDisabled }: any) => <form onSubmit={onSubmit}>{children}<button disabled={submitDisabled}>Save changes</button></form> }));
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
});
