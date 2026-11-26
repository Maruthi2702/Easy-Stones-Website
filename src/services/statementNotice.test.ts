import { describe, it, expect, vi } from 'vitest';
import { notifyNewMissingReceipts } from './statementNotice.ts';
import { statementNoticeWords } from '../utils/receiptReminders.ts';

const MARU = 'a'.repeat(24), ANN = 'b'.repeat(24), GONE = 'c'.repeat(24);
const staff = [
  { _id: MARU, displayName: 'Maruthi', email: 'maru@example.com', isActive: true, role: 'sales_rep' },
  { _id: ANN, displayName: 'Ann', email: '', isActive: true, role: 'sales_rep' },
  { _id: GONE, displayName: 'Gone', email: 'gone@example.com', isActive: false, role: 'sales_rep' }
];
const fresh = [
  { userId: MARU, date: '2026-11-20', merchant: 'SHELL', cents: 6120 },
  { userId: MARU, date: '2026-11-18', merchant: 'HOME DEPOT', cents: 4000 },
  { userId: ANN, date: '2026-11-19', merchant: 'UBER', cents: 2500 },
  { userId: GONE, date: '2026-11-19', merchant: 'LYFT', cents: 900 }
];
const rig = (on: boolean) => {
  const sendEmail = vi.fn(async () => ({ success: true }));
  const sendPush = vi.fn(async () => undefined);
  return { sendEmail, sendPush, deps: { switchOn: async () => on, findStaff: async () => staff as never, senders: { sendEmail, sendPush, phonesOf: async (ids: string[]) => ids } } };
};

describe('statement notice to holders with new Missing receipts', () => {
  it('sends nothing at all while the automatic-reminders switch is off', async () => {
    const r = rig(false);
    expect(await notifyNewMissingReceipts(fresh, r.deps)).toMatchObject({ skipped: 'switch off', emails: 0, pushes: 0 });
    expect(r.sendEmail).not.toHaveBeenCalled();
    expect(r.sendPush).not.toHaveBeenCalled();
  });

  it('with it on: one email and one push per active holder, listing their charges; no email address = push only; deactivated skipped', async () => {
    const r = rig(true);
    const out = await notifyNewMissingReceipts(fresh, r.deps);
    expect(out).toMatchObject({ emails: 1, pushes: 2, people: 2 });
    expect(r.sendEmail).toHaveBeenCalledTimes(1);
    const mail = r.sendEmail.mock.calls[0] as unknown as [{ to: string; subject: string; html: string }];
    expect(mail[0].to).toBe('maru@example.com');
    expect(mail[0].subject).toBe('Receipts needed: 2 card charges');
    expect(mail[0].html).toContain('SHELL');
    expect(mail[0].html).toContain('HOME DEPOT');
    expect(r.sendPush.mock.calls.map((c) => (c as unknown as [string[]])[0][0]).sort()).toEqual([MARU, ANN].sort());
  });

  it('does nothing when the upload made no Missing rows', async () => {
    const r = rig(true);
    expect(await notifyNewMissingReceipts([], r.deps)).toMatchObject({ skipped: 'nothing new' });
    expect(r.sendEmail).not.toHaveBeenCalled();
  });

  it('never throws when sending fails', async () => {
    const r = rig(true);
    r.sendEmail.mockRejectedValue(new Error('smtp down'));
    r.sendPush.mockRejectedValue(new Error('apns down'));
    await expect(notifyNewMissingReceipts(fresh, r.deps)).resolves.toMatchObject({ emails: 0, pushes: 0 });
  });
});

describe('statementNoticeWords', () => {
  it('names one charge, or counts several with a total', () => {
    const one = statementNoticeWords([{ date: '2026-11-20', merchant: 'SHELL', cents: 6120 }]);
    expect(one.email.subject).toBe('Receipt needed: SHELL $61.20');
    expect(one.push).toMatchObject({ title: 'Receipt needed', path: '/sales?tab=card_receipts' });
    const many = statementNoticeWords([{ date: '2026-11-20', merchant: 'SHELL', cents: 6120 }, { date: '2026-11-18', merchant: 'UBER', cents: 2500 }]);
    expect(many.email.headline).toBe('2 card charges need your receipts');
    expect(many.email.total).toBe('$86.20');
    expect(many.push.body).toBe('2 card charges need a receipt');
  });
});
