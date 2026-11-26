// @vitest-environment jsdom
// Upload receipt on an expense that came from the bank's report (2026-11-26): the "No receipt yet" box is a button, the
// Camera / Photo / File choice has no Lost Receipt row, and once a receipt is on it the category must be confirmed before Save.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import AddReceiptChoice from './AddReceiptChoice';
import ExpenseDrawer from './ExpenseDrawer';
import ExpenseForm from './ExpenseForm';

const CATEGORIES = [
  { _id: 'k1', name: 'travel_lunch', label: 'Travel Lunch', order: 0, active: true, fields: { customer: false, attendees: false, purpose: false, recurring: false } },
  { _id: 'k3', name: 'fuel', label: 'Fuel', order: 2, active: true, fields: { customer: false, attendees: false, purpose: false, recurring: false } }
];
const fromReport = (o: Record<string, unknown> = {}) => ({
  id: 'x1', userId: 'u1', holderName: 'Krish', cardId: 'c1', cardLabel: 'MARU92069', location: 'Seattle', date: '2026-11-02',
  merchant: 'RENDER.COM SAN FRANCISCO CA', cents: 700, subtotalCents: null, taxCents: null, tipCents: null, category: '', subcategory: '',
  customerId: '', customerName: '', attendees: [], purpose: '', note: '', recurring: false, receiptUrl: '', lostReason: '', status: 'waiting',
  approval: null, sentBack: null, voided: null, createdAt: '2026-11-24T13:53:00Z', updatedAt: '2026-11-24T13:53:00Z', history: [], mine: true, canDecide: false,
  actions: { approve: null, sendBack: false, ask: false, withdrawAsk: false, answer: false, reopen: false, fillDetails: false }, chips: [], ...o
});
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); };
const text = () => document.body.textContent || '';
const later = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 15)); // the real upload and reading take a moment
const pdf = () => new File(['%PDF-1.4 test'], 'receipt.pdf', { type: 'application/pdf' });

Element.prototype.scrollIntoView = () => {};
afterEach(() => { cleanup(); });

describe('the "No receipt yet" box', () => {
  const drawer = (extra: Record<string, unknown>) => render(
    <ExpenseDrawer expense={fromReport() as never} categories={CATEGORIES as never} canEdit canVoid={false} onEdit={() => {}} onVoid={() => {}}
      onApprove={async () => {}} onAnswer={async () => {}} onSendBack={async () => {}} onAsk={() => {}} onWithdrawAsk={async () => {}}
      onReopen={() => {}} onRemind={() => {}} onFillDetails={async () => {}} onClose={() => {}} {...extra as object} />);

  it('is a button that asks to upload the receipt', () => {
    const onUploadReceipt = vi.fn();
    drawer({ onUploadReceipt });
    fireEvent.click(screen.getByRole('button', { name: /Upload receipt/ }));
    expect(onUploadReceipt).toHaveBeenCalled();
  });

  it('stays plain text for someone who may not edit it', () => {
    drawer({ onUploadReceipt: vi.fn(), canEdit: false });
    expect(screen.queryByRole('button', { name: /Upload receipt/ })).toBeNull();
    expect(text()).toContain('No receipt yet');
  });
});

describe('the choice for an existing expense', () => {
  it('has no Lost Receipt or Add several row and says Upload receipt', () => {
    render(<AddReceiptChoice title="Upload receipt" onCamera={() => {}} onFile={() => {}} onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Upload receipt' })).toBeTruthy();
    expect(screen.getByText('Open Camera')).toBeTruthy();
    expect(screen.queryByText('Lost Receipt')).toBeNull();
    expect(screen.queryByText('Add several')).toBeNull();
  });
});

describe('confirming the category after the upload', () => {
  const open = async (category: string, onSave = vi.fn(async (_body: unknown) => undefined)) => {
    const upload = vi.fn(() => later({ url: '/api/card-receipts/files/pdf_1700000000000_aaaaaaaaaaaaaaaaaaaaaaaa.pdf' }));
    const scan = vi.fn(() => later({ scan: { isReceipt: true, date: '', merchant: '', totalCents: null, subtotalCents: null, taxCents: null, tipCents: null, category } }));
    render(<ExpenseForm expense={fromReport() as never} initialFile={pdf()} confirmCategory cardLabel="MARU92069" holderName="Krish" today="2026-11-26"
      categories={CATEGORIES as never} upload={upload} scan={scan} onSave={onSave} onClose={() => {}} />);
    await settle();
    return { onSave, upload };
  };

  it('holds Save until the read category is confirmed', async () => {
    const { onSave } = await open('fuel');
    expect(text()).toContain('Check the category');
    fireEvent.click(screen.getByRole('button', { name: /Send for approval/ }));
    await settle();
    expect(onSave).not.toHaveBeenCalled();
    expect(text()).toContain('Confirm the category before saving.');
    fireEvent.click(screen.getByRole('button', { name: 'Yes, it’s right' }));
    expect(text()).not.toContain('Check the category');
    fireEvent.click(screen.getByRole('button', { name: /Send for approval/ }));
    await settle();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({ category: 'fuel', receiptUrl: expect.stringContaining('/files/') });
  });

  it('asks for a pick when the reading found no category', async () => {
    const { onSave } = await open('');
    expect(text()).toContain('Pick the category for this receipt.');
    expect(screen.queryByRole('button', { name: 'Yes, it’s right' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Save draft/ }));
    await settle();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('does not ask anything of an ordinary edit', async () => {
    const onSave = vi.fn(async () => undefined);
    render(<ExpenseForm expense={fromReport({ category: 'fuel', receiptUrl: '/x.jpg' }) as never} cardLabel="MARU92069" holderName="Krish" today="2026-11-26"
      categories={CATEGORIES as never} upload={async () => ({ url: '' })} onSave={onSave} onClose={() => {}} />);
    await settle();
    expect(text()).not.toContain('Check the category');
  });
});
