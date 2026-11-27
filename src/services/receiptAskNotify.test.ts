import { describe, it, expect } from 'vitest';
import { notifyAsked, notifyAnswered } from './receiptAskNotify.ts';

const expense = { holderName: 'Dan Ortiz', merchant: 'Shell', cents: 24000, date: '2026-11-20' };
const ask = { to: 'u-maria', toName: 'Maria Lopez', by: 'u-ann', byName: 'Ann Count', question: 'Which job was this <for>?', answer: 'The Kent job', answeredAt: null };

describe('asking about a receipt: push and email', () => {
  it('tells the person asked, with the question, by push and email', async () => {
    const pushes: unknown[] = [], mails: { to: string; subject: string; html: string }[] = [];
    await notifyAsked(expense, { ...ask, byName: 'Maria Lopez' }, {
      push: async (ids, m) => { pushes.push([ids, m]); }, email: async (o) => { mails.push(o); },
      findPerson: async (id) => ({ email: `${id}@x.test` }), base: 'https://app.test'
    });
    expect(pushes).toEqual([[['u-maria'], { title: 'Question about a receipt', body: 'Maria asked about Dan’s $240.00 receipt (Shell, Nov 20): Which job was this <for>?', path: '/sales?tab=card_receipts' }]]);
    expect(mails[0]).toMatchObject({ to: 'u-maria@x.test', subject: 'Question about Dan’s $240.00 receipt (Shell, Nov 20)' });
    expect(mails[0]!.html).toContain('Which job was this &lt;for&gt;?');
    expect(mails[0]!.html).toContain('https://app.test/sales?tab=card_receipts');
  });

  it('tells whoever asked when it is answered, and never throws when sending fails', async () => {
    const pushed: string[][] = [];
    await notifyAnswered(expense, ask, {
      push: async (ids) => { pushed.push(ids); throw new Error('apple down'); },
      email: async () => { throw new Error('smtp down'); }, findPerson: async () => ({ email: 'ann@x.test' })
    });
    expect(pushed).toEqual([['u-ann']]);
    // Someone with no email gets only the push.
    let mailed = false;
    await notifyAnswered(expense, ask, { push: async () => undefined, email: async () => { mailed = true; }, findPerson: async () => ({ email: '' }) });
    expect(mailed).toBe(false);
  });

  it('says a receipt came back, not approved, when the person asked returned it', async () => {
    const pushes: { title: string; body: string }[] = [], mails: { subject: string; html: string }[] = [];
    await notifyAnswered(expense, { ...ask, answer: 'Personal, not a job', declined: true }, {
      push: async (_ids, m) => { pushes.push(m); }, email: async (o) => { mails.push(o); }, findPerson: async () => ({ email: 'ann@x.test' })
    });
    expect(pushes[0]).toMatchObject({ title: 'Receipt returned to you' });
    expect(pushes[0]!.body).toContain('didn’t approve');
    expect(mails[0]!.subject).toMatch(/^Returned, not approved:/);
    expect(mails[0]!.html).toContain('Personal, not a job');
  });
});
