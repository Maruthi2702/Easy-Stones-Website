// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import PhoneRows, { type QuickActions } from './PhoneRows';
import NeedsYou from './NeedsYou';
import type { ListSelection } from './ExpenseList';
import type { Category, Expense } from '../types';

const categories = [{ _id: 'c1', name: 'meals', label: 'Meals', order: 1, active: true, fields: {}, subcategories: [] }] as unknown as Category[];
const exp = (over: Partial<Expense>): Expense => ({
  id: 'e', userId: 'u1', holderName: 'Jordan Hale', cardId: 'c', cardLabel: 'JORD40218', location: 'Seattle', holderRole: 'sales_rep', issuer: 'amex',
  date: '2026-11-24', merchant: 'Home Depot', cents: 8642, category: 'meals', subcategory: '', receiptUrl: '/r.jpg', lostReason: '', status: 'waiting',
  approval: null, secondApproval: null, ask: null, voided: null, mine: false, canDecide: false, recurring: false, ...over
}) as unknown as Expense;
const decide = (approve: 'accounting' | 'second' | null = 'accounting', over: Partial<Expense> = {}) => exp({
  canDecide: true, actions: { approve, sendBack: true, ask: false, withdrawAsk: false, answer: false, reopen: false, fillDetails: false }, ...over
});

const rows = [
  exp({ id: 'a', date: '2026-11-24', merchant: 'Home Depot', cents: 8642 }),
  exp({ id: 'b', date: '2026-11-24', merchant: 'Shell', cents: 6410, status: 'approved', holderName: 'Priya Nair', cardLabel: 'PRIY11873' }),
  exp({ id: 'c', date: '2026-11-23', merchant: 'Capital Grille', cents: 31258, holderName: 'Marco Ruiz', cardLabel: 'MARC55302' })
];
const selection = (over: Partial<ListSelection> = {}): ListSelection => ({
  selected: new Set(), onToggle: vi.fn(), allShown: false, onToggleAll: vi.fn(), active: false, selectable: () => true, onStart: vi.fn(), ...over
});

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('PhoneRows', () => {
  it('lists a heading per day with the day total, and Yesterday on the branch clock', () => {
    render(<PhoneRows rows={rows} today="2026-11-25" categories={categories} showHolder selection={null} onOpen={() => {}} />);
    const yesterday = screen.getByRole('region', { name: 'Yesterday · Tue, Nov 24' });
    expect(within(yesterday).getByText('$150.52')).toBeTruthy();
    expect(within(yesterday).getAllByRole('button')).toHaveLength(2);
    expect(screen.getByRole('region', { name: 'Mon, Nov 23' })).toBeTruthy();
  });

  it('puts holder and card ID first, then the merchant, the category, and the amount and status on the right', () => {
    render(<PhoneRows rows={[rows[0]!]} today="2026-11-25" categories={categories} showHolder selection={null} onOpen={() => {}} />);
    const row = screen.getByRole('button');
    expect(within(row).getByText('Jordan Hale')).toBeTruthy();
    expect(within(row).getByText('JORD40218')).toBeTruthy();
    expect(within(row).getByText('Home Depot')).toBeTruthy();
    expect(within(row).getByText('Meals')).toBeTruthy();
    expect(within(row).getByText('$86.42')).toBeTruthy();
    expect(within(row).getByText('Waiting').className).toContain('is-wait');
    expect(row.textContent).not.toContain('JH');
  });

  it('shows no holder line for your own receipts, the merchant leading', () => {
    render(<PhoneRows rows={[rows[0]!]} today="" categories={categories} showHolder={false} selection={null} onOpen={() => {}} />);
    expect(screen.queryByText('Jordan Hale')).toBeNull();
    expect(screen.getByText('Home Depot').className).toContain('is-first');
  });

  it('opens the receipt on a tap', () => {
    const onOpen = vi.fn();
    render(<PhoneRows rows={[rows[0]!]} today="" categories={categories} showHolder selection={selection()} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalledWith(rows[0]);
  });

  it('starts selecting on press and hold, and that hold does not also open the receipt', () => {
    const onOpen = vi.fn();
    const sel = selection();
    render(<PhoneRows rows={[rows[0]!]} today="" categories={categories} showHolder selection={sel} onOpen={onOpen} />);
    const row = screen.getByRole('button');
    fireEvent.pointerDown(row);
    act(() => { vi.advanceTimersByTime(500); });
    expect(sel.onStart).toHaveBeenCalledWith('a');
    fireEvent.pointerUp(row);
    fireEvent.click(row);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('does not select on a short press', () => {
    const sel = selection();
    render(<PhoneRows rows={[rows[0]!]} today="" categories={categories} showHolder selection={sel} onOpen={() => {}} />);
    const row = screen.getByRole('button');
    fireEvent.pointerDown(row);
    act(() => { vi.advanceTimersByTime(200); });
    fireEvent.pointerUp(row);
    act(() => { vi.advanceTimersByTime(500); });
    expect(sel.onStart).not.toHaveBeenCalled();
  });

  it('ticks rows once selecting, and leaves the ones that cannot be selected alone', () => {
    const sel = selection({ active: true, selectable: (e) => e.id === 'a' });
    render(<PhoneRows rows={rows.slice(0, 2)} today="" categories={categories} showHolder selection={sel} onOpen={vi.fn()} />);
    const [first, second] = screen.getAllByRole('button');
    fireEvent.click(first!);
    fireEvent.click(second!);
    expect(sel.onToggle).toHaveBeenCalledTimes(1);
    expect(sel.onToggle).toHaveBeenCalledWith('a');
  });

  describe('in Waiting for me', () => {
    const quick = (): QuickActions => ({ approve: vi.fn(), sendBack: vi.fn(), withdraw: vi.fn(), busyId: '' });
    it('approves in one tap and sends back from the row, without opening the receipt', () => {
      const q = quick();
      const onOpen = vi.fn();
      render(<PhoneRows rows={[decide()]} today="" categories={categories} showHolder selection={null} onOpen={onOpen} quick={q} />);
      fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
      fireEvent.click(screen.getByRole('button', { name: 'Send back' }));
      expect(q.approve).toHaveBeenCalledTimes(1);
      expect(q.sendBack).toHaveBeenCalledTimes(1);
      expect(onOpen).not.toHaveBeenCalled();
    });
    it('opens a lost receipt first, because the approver must comment', () => {
      const q = quick();
      const onOpen = vi.fn();
      render(<PhoneRows rows={[decide('accounting', { receiptUrl: '', lostReason: 'Left it at the counter' })]} today="" categories={categories} showHolder selection={null} onOpen={onOpen} quick={q} />);
      fireEvent.click(screen.getByRole('button', { name: 'Approve with comment' }));
      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(q.approve).not.toHaveBeenCalled();
    });
    it('waits while that row is being approved', () => {
      const q = { ...quick(), busyId: 'e' };
      render(<PhoneRows rows={[decide()]} today="" categories={categories} showHolder selection={null} onOpen={() => {}} quick={q} />);
      expect((screen.getByRole('button', { name: 'Approving…' }) as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByRole('button', { name: 'Send back' }) as HTMLButtonElement).disabled).toBe(true);
    });
    it('has no buttons on a receipt the viewer cannot decide', () => {
      render(<PhoneRows rows={[exp({})]} today="" categories={categories} showHolder selection={null} onOpen={() => {}} quick={quick()} />);
      expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Send back' })).toBeNull();
    });
    it('offers to withdraw a question the viewer asked', () => {
      const q = quick();
      const asked = exp({ actions: { approve: null, sendBack: false, ask: false, withdrawAsk: true, answer: false, reopen: false, fillDetails: false } });
      render(<PhoneRows rows={[asked]} today="" categories={categories} showHolder selection={null} onOpen={() => {}} quick={q} />);
      fireEvent.click(screen.getByRole('button', { name: 'Withdraw question' }));
      expect(q.withdraw).toHaveBeenCalledTimes(1);
    });
  });
});

describe('NeedsYou', () => {
  const missing = exp({ id: 'm', merchant: 'Chevron', cents: 7103, status: 'missing', receiptUrl: '', category: '', date: '2026-11-12' });
  const draft = exp({ id: 'd', merchant: 'Office Depot', cents: 2340, status: 'draft', date: '2026-11-03' });
  it('gives a missing receipt Upload receipt and a draft Finish it, and opens the receipt either way', () => {
    const onOpen = vi.fn();
    render(<NeedsYou todo={[missing, draft]} categories={categories} expanded={false} onToggle={() => {}} onOpen={onOpen} />);
    expect(screen.getByText('From earlier months · 2')).toBeTruthy();
    expect(screen.getByText('$94.43')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Upload receipt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Finish it' }));
    expect(onOpen.mock.calls.map((c) => (c[0] as Expense).id)).toEqual(['m', 'd']);
  });
  it('shows nothing when there is nothing to do', () => {
    const { container } = render(<NeedsYou todo={[]} categories={categories} expanded={false} onToggle={() => {}} onOpen={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});
