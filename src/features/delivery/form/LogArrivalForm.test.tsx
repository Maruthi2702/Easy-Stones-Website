import type { ReactNode, FormEventHandler } from 'react';
// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import LogArrivalForm from './LogArrivalForm';
vi.mock('../../../components/shared/calendar/Calendar', () => ({ DatePicker: ({ id, value, onChange }: { id?: string; value: string; onChange: (value: string) => void }) => <input id={id} value={value} onChange={e => onChange(e.target.value)} /> }));
vi.mock('../../../components/shared/form/LocationPicker', () => ({ default: ({ id, value, onChange, options }: { id: string; value: string; onChange: (v: string) => void; options: string[] }) => <select id={id} value={value} onChange={e => onChange(e.target.value)}><option value="" />{options.map(o => <option key={o} value={o}>{o}</option>)}</select> }));
vi.mock('../../../components/shared/form/FormModal', () => ({ default: ({ children, onSubmit }: { children: ReactNode; onSubmit: FormEventHandler<HTMLFormElement> }) => <form onSubmit={onSubmit}>{children}<button>Log arrival</button></form> }));
afterEach(cleanup);

const user = { username: 'dee', assignedLocations: ['Seattle'] };
const trucks = [{ id: 'drv_angel', name: 'Angel', driver: 'Angel', color: '' }, { id: 'trk_3rd_party', name: '3rd Party Freight', driver: '', color: '' }];
const renderForm = (onSave = vi.fn(async () => {}), onClose = vi.fn()) => {
  render(<LogArrivalForm currentUser={user} trucks={trucks} locationsList={[{ name: 'Seattle' }, { name: 'Spokane' }]} onSave={onSave} onClose={onClose} />);
  return { onSave, onClose };
};

describe('Log arrival form', () => {
  it('starts at the person’s branch, on contract freight, and won’t save without a sender', async () => {
    const { onSave } = renderForm();
    expect((screen.getByLabelText(/Arrived at/) as HTMLSelectElement).value).toBe('Seattle');
    fireEvent.click(screen.getByRole('button', { name: 'Log arrival' }));
    await waitFor(() => expect(screen.getByText('Pick the branch it came from')).toBeTruthy());
    expect(onSave).not.toHaveBeenCalled();
  });

  it('sends the arrival with its own id, then closes', async () => {
    const { onSave, onClose } = renderForm();
    fireEvent.change(screen.getByLabelText(/^From/), { target: { value: 'Spokane' } });
    fireEvent.change(screen.getByLabelText(/Slabs received/), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText(/Transfer #/), { target: { value: '18 936' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log arrival' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      from: 'Spokane', to: 'Seattle', numberOfSlabs: 12, transferNumber: '18936', truckId: 'trk_3rd_party', id: expect.stringMatching(/^del_/)
    }));
  });

  it('keeps the form open with the server’s reason', async () => {
    const { onClose } = renderForm(vi.fn(async () => { throw Error('Transfer # 18936 is already on the schedule'); }));
    fireEvent.change(screen.getByLabelText(/^From/), { target: { value: 'Spokane' } });
    fireEvent.change(screen.getByLabelText(/Slabs received/), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log arrival' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/already on the schedule/);
    expect(onClose).not.toHaveBeenCalled();
  });
});
