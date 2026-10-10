// What the Selection Sheet email says: a Price / SF column only when asked
// for, printed notes always, internal notes never.
import { describe, it, expect, beforeAll, vi } from 'vitest';

const sendMail = vi.fn(async () => ({}));
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }));

const { sendSelectionSheetEmail } = await import('./emailService.js');

const checkIn = {
  name: 'Pat Visitor', phone: '(206) 555-0142', createdAt: '2026-10-10T17:00:00Z', salesRep: 'Rita',
  specialNotes: 'Compare under daylight', internalNotes: 'Builder pricing — staff only',
  selections: [
    { material: 'CALACATTA GOLD', lot: '13845', details: '7', size: '126x63', priceCentsPerSf: 6800 },
    { material: 'ABSOLUTE BLACK', lot: '22001', details: '1, 2', size: '126x63', priceCentsPerSf: null }
  ]
};
const htmlOf = async (opts) => {
  sendMail.mockClear();
  const result = await sendSelectionSheetEmail(checkIn, 'to@example.com', undefined, opts);
  expect(result.success).toBe(true);
  return sendMail.mock.calls[0][0].html;
};

beforeAll(() => {
  delete process.env.RESEND_API_KEY;
  process.env.SMTP_USER = 'test@example.com';
  process.env.SMTP_PASS = 'x';
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('sendSelectionSheetEmail', () => {
  it('has no prices by default', async () => {
    const html = await htmlOf();
    expect(html).not.toContain('Price / SF');
    expect(html).not.toContain('$68.00');
  });

  it('adds Price / SF when asked, "—" for a material without one', async () => {
    const html = await htmlOf({ showPrices: true });
    expect(html).toContain('Price / SF');
    expect(html).toContain('$68.00');
    expect(html).toContain('—');
  });

  it('always has the printed notes and never the internal ones', async () => {
    for (const opts of [undefined, { showPrices: true }]) {
      const html = await htmlOf(opts);
      expect(html).toContain('Compare under daylight');
      expect(html).not.toContain('staff only');
    }
  });
});
