import type { Loose } from '../types/records.ts';
// What the Selection Sheet email says: a Price / SF column only when asked
// for, printed notes always, internal notes never.
import { describe, it, expect, beforeAll, vi } from 'vitest';

const sendMail = vi.fn<(message: { html: string; subject?: string; from?: string; replyTo?: string }) => Promise<unknown>>(async () => ({}));
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }));

const { sendSelectionSheetEmail } = await import('./emailService.ts');

const checkIn = {
  name: 'Pat Visitor', phone: '(206) 555-0142', createdAt: '2026-10-10T17:00:00Z', salesRep: 'Rita', salesRepEmail: 'rita@x.com',
  location: 'Kent', fabricatorCompany: 'Intown', fabricatorPhone: '(425) 306-8522',
  specialNotes: 'Compare under daylight', internalNotes: 'Builder pricing — staff only',
  selections: [
    { material: 'CALACATTA GOLD', lot: '13845', details: '7', size: '126x63', priceCentsPerSf: 6800 },
    { material: 'ABSOLUTE BLACK', lot: '22001', details: '1, 2', size: '126x63', priceCentsPerSf: null }
  ]
};
const messageOf = async (opts: { showPrices?: boolean; markUrl?: string } = {}, record: typeof checkIn = checkIn) => {
  sendMail.mockClear();
  const result = await sendSelectionSheetEmail(record, 'to@example.com', undefined, opts);
  expect(result.success).toBe(true);
  return sendMail.mock.calls[0]![0];
};
const htmlOf = async (opts: { showPrices?: boolean; markUrl?: string } = {}) => (await messageOf(opts)).html;

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

  it('adds each price when asked, "Ask your rep" for a material without one', async () => {
    const html = await htmlOf({ showPrices: true });
    expect(html).toContain('$68.00');
    expect(html).toContain('Ask your rep');
    expect(html).toContain('Prices per square foot');
  });

  it('fits a phone: one row per material, no wide table, capped at 600px', async () => {
    const html = await htmlOf({ showPrices: true });
    expect(html).not.toContain('<th');
    expect(html).toContain('max-width: 600px');
    expect(html).toContain('CALACATTA GOLD');
    expect(html).toContain('Lot 13845 &middot; Slabs 7 &middot; 126 * 63 in');
  });

  // The printed sheet's template (owner, 2026-11-07).
  it('is the printed sheet: the same sections, policy and footer', async () => {
    const html = await htmlOf();
    for (const text of ['Stone Selection', 'Oct 10, 2026 · Kent', 'PREPARED FOR', 'FABRICATOR', 'Intown', 'YOUR SALES REP', 'rita@<wbr>x.com',
      'Your selections', '2 materials', 'Hold Policy', 'Questions? Ask Rita or call the showroom.', 'Easy Stones Kent · 6012 S 196th St, Kent, WA 98032'])
      expect(html, text).toContain(text);
    expect(html).not.toContain('Check-In Portal');
  });

  // A forward (Outlook, Apple Mail) drops inline-block layouts and text-transform.
  it('keeps the three people in a table and their labels in capitals, so a forward keeps them', async () => {
    const html = await htmlOf();
    expect(html).not.toContain('inline-block');
    expect(html).toMatch(/<td width="32%"[^>]*>\s*<div[^>]*>PREPARED FOR<\/div>/);
  });

  // Dark mode repaints the email; the logo image's dark lettering vanished there.
  it('shows the gold mark beside the name as text, so it reads in dark mode', async () => {
    const html = await htmlOf({ markUrl: 'https://easystones.example/favicon.png' });
    expect(html).toContain('<img src="https://easystones.example/favicon.png"');
    expect(html).not.toContain('logo.png');
    expect(html).toMatch(/>EASY STONES<\/td>/);
    expect(await htmlOf()).not.toContain('<img');
  });

  it('links phones and emails in the text\'s own colour (a phone app would turn them blue)', async () => {
    const html = await htmlOf();
    expect(html).toContain('<a href="tel:+12065550142" style="color: inherit; text-decoration: none;">(206) 555-0142</a>');
    expect(html).toContain('<a href="tel:+14253068522"');
    expect(html).toContain('<a href="mailto:rita@x.com" style="color: inherit; text-decoration: none;">rita@<wbr>x.com</a>');
  });

  it('is titled "Selection Sheet: <name>", from Easy Stones, replies to the rep', async () => {
    const message = await messageOf();
    expect(message.subject).toBe('Selection Sheet: Pat Visitor');
    expect(message.from).toMatch(/^"?Easy Stones"? </);
    expect(message.replyTo).toBe('rita@x.com');
    const noRep = await messageOf({}, { ...checkIn, salesRep: '', salesRepEmail: 'old@x.com' });
    expect(noRep.from).toMatch(/^"?Easy Stones"? </);
    expect(noRep.replyTo).toBeUndefined();
  });

  it('always has the printed notes and never the internal ones', async () => {
    for (const opts of [undefined, { showPrices: true }]) {
      const html = await htmlOf(opts);
      expect(html).toContain('Compare under daylight');
      expect(html).not.toContain('staff only');
    }
  });
});
