import type { Loose } from '../types/records.ts';
// What the Selection Sheet email says: a Price / SF column only when asked
// for, printed notes always, internal notes never.
import { describe, it, expect, beforeAll, vi } from 'vitest';

const sendMail = vi.fn<(message: { html: string; subject?: string; from?: { name: string; address: string }; replyTo?: string }) => Promise<unknown>>(async () => ({}));
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
  delete process.env.SES_FROM_EMAIL;
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
    // Each figure under its own label, so a slab number isn't read as a count.
    for (const [label, value] of [['LOT #', '13845'], ['SLAB #', '7'], ['SIZE (IN)', '126 * 63']])
      expect(html).toMatch(new RegExp(`>${label.replace(/[()#]/g, '\\$&')}</div><div[^>]*>${value.replace(/[*]/g, '\\*')}</div>`));
    expect(html).not.toContain('Slabs 7');
  });

  // The printed sheet's template (owner, 2026-11-07).
  it('is the printed sheet: the same sections, policy and footer', async () => {
    const html = await htmlOf();
    for (const text of ['Stone Selection', 'Oct 10, 2026 · Kent', 'PREPARED FOR', 'FABRICATOR', 'Intown', 'YOUR SALES REP', 'rita@x.com',
      'Your selections', '2 materials', 'Hold Policy', 'Questions? Ask Rita or call the showroom.', 'Easy Stones Kent · 6012 S 196th St, Kent, WA 98032'])
      expect(html, text).toContain(text);
    expect(html).not.toContain('Check-In Portal');
  });

  // A forward (Outlook, Apple Mail) dropped our text-align and text-transform.
  it('lays the people out left-aligned, labels in capitals, so a forward keeps them', async () => {
    const html = await htmlOf();
    expect(html).toMatch(/<td align="left"[^>]*><div style="display: inline-block;[^"]*text-align: left;"><table[^>]*><tr><td align="left"[^>]*><div[^>]*>PREPARED FOR<\/div>/);
    expect(html).toContain('</td></tr></table></div><div style="display: inline-block;');
  });

  // Three phone-width columns broke the rep's email in two.
  it('keeps a phone or an email on one line', async () => {
    const html = await htmlOf();
    expect(html).toMatch(/white-space: nowrap;"><a href="mailto:rita@x\.com"/);
    // The rep has no set width, so a long email moves under the other two instead of past the card.
    expect(html).toMatch(/<div style="display: inline-block; vertical-align: top; max-width: 100%; margin: 0 0px 14px 0;[^"]*"><table role="presentation" cellpadding[^>]*><tr><td[^>]*><div[^>]*>YOUR SALES REP/);
  });

  // Dark mode repaints the email; the logo image's dark lettering vanished there.
  it('shows the gold mark beside the name as text, so it reads in dark mode', async () => {
    const html = await htmlOf({ markUrl: 'https://easystones.example/favicon.png' });
    expect(html).toContain('<img src="https://easystones.example/favicon.png"');
    expect(html).not.toContain('logo.png');
    expect(html).toMatch(/>EASY STONES<\/td>/);
    expect(await htmlOf()).not.toContain('<img');
  });

  // A phone app turned them blue; so did a forward, which ignores `color: inherit`.
  it('links phones and emails in the text\'s own colour, named outright', async () => {
    const html = await htmlOf();
    expect(html).toContain('<a href="tel:+12065550142" style="color: #3D434B; text-decoration: none;"><span style="color: #3D434B;">(206) 555-0142</span></a>');
    expect(html).toContain('<a href="tel:+14253068522"');
    expect(html).toContain('<a href="mailto:rita@x.com" style="color: #3D434B; text-decoration: none;"><span style="color: #3D434B;">rita@x.com</span></a>');
    expect(html).not.toContain('inherit');
  });

  // A forward dropped a sized div's width / height: the step rings stretched into
  // the words, and the people lost their widths and sat 12px apart.
  it('keeps the step rings round and apart from their words, and the people apart, after a forward', async () => {
    const html = await htmlOf();
    expect(html).toMatch(/<td width="20" height="20" align="center" valign="middle" style="[^"]*border-radius: 11px;[^"]*">1<\/td>/);
    expect(html).toMatch(/<td style="padding: 8px 0 0 10px;[^"]*">Give this sheet to your fabricator\.<\/td>/);
    expect(html).not.toMatch(/<div style="width: 20px; height: 20px/);
    // Each person's width is a table's width attribute, which a forward keeps.
    for (const [width, label] of [[165, 'PREPARED FOR'], [165, 'FABRICATOR']] as const)
      expect(html, label).toMatch(new RegExp(`<table role="presentation" width="${width}"[^>]*><tr><td[^>]*><div[^>]*>${label}<`));
    expect(html.match(/margin: 0 20px 14px 0;/g)).toHaveLength(2);
  });

  it('is titled "Selection Sheet: <name>", from Easy Surfaces, replies to the rep', async () => {
    const message = await messageOf();
    expect(message.subject).toBe('Selection Sheet: Pat Visitor');
    expect(message.from?.name).toBe('Easy Surfaces');
    expect(message.replyTo).toBe('rita@x.com');
    const noRep = await messageOf({}, { ...checkIn, salesRep: '', salesRepEmail: 'old@x.com' });
    expect(noRep.from?.name).toBe('Easy Surfaces');
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
