import type { Loose } from '../types/records.ts';
import nodemailer from 'nodemailer';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import type { SendMailOptions } from 'nodemailer';
import { DEFAULT_LETTERHEAD } from '../utils/locationForm.ts';
import { sheetDoc, docRowsFromSelections, sheetPriceLabel, HOLD_POLICY, SHEET_LABELS } from '../utils/selectionSheet.ts';
import { checkInZone } from '../utils/checkInClock.ts';
import { SENDER_NAME } from '../utils/emailSender.ts';

// The check-in emails below interpolate visitor-supplied fields (name, notes,
// selections...) straight into HTML. The self check-in endpoint that produces
// most of that data requires no login, so an unescaped field is an open door
// to email HTML/phishing-content injection (spoofed links, tracking pixels,
// broken layout) landing in a staff inbox.
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[ch]!));

/**
 * Every email the app sends goes through sendEmail: **Amazon SES first, Gmail
 * SMTP as the backup** (owner, 2026-11-08). Gmail is tried when SES isn't set
 * up, or refuses or fails to take the message — including while the SES
 * account is still in the sandbox, where it only sends to verified addresses.
 *
 *   SES_FROM_EMAIL           the sender, an address on the SES-verified domain
 *                            (e.g. noreply@easystones.com); unset = SES is off
 *   SES_REGION               default AWS_REGION, else us-east-2
 *   SES_CONFIGURATION_SET    optional: the aws-infra email stack's set (bounce /
 *                            complaint tracking)
 *   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY   the server's IAM user (Render);
 *                            on AWS the function's own role
 *   SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS   the Gmail backup, as before
 *
 * Both are fed the same message by nodemailer (SES through its SESv2
 * transport), so attachments, Reply-To and the sender's name work the same
 * either way. `attachments` is [{ filename, content }], content a Buffer or
 * Uint8Array.
 */
type EmailOptions = {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
  defaultSenderName?: string;
  attachments?: { filename: string; content: Uint8Array }[];
};

/** Which way an email went: SES, or the Gmail backup. */
export type EmailVia = 'ses' | 'smtp';
export type EmailResult = { success: boolean; error: string | null; via: EmailVia | null };

const DEFAULT_SENDER_NAME = SENDER_NAME;

/** One SES client per region for the life of the server. */
const sesClients = new Map<string, SESv2Client>();
function sesClient(region: string): SESv2Client {
  let client = sesClients.get(region);
  if (!client) {
    client = new SESv2Client({ region });
    sesClients.set(region, client);
  }
  return client;
}

function messageFrom(address: string, { to, subject, html, replyTo, defaultSenderName, attachments = [] }: EmailOptions): SendMailOptions {
  const message: SendMailOptions = {
    from: { name: defaultSenderName || DEFAULT_SENDER_NAME, address },
    to: Array.isArray(to) ? to.join(', ') : to,
    subject,
    html
  };
  if (replyTo) message.replyTo = replyTo;
  if (attachments.length) message.attachments = attachments.map(a => ({ filename: a.filename, content: Buffer.from(a.content) }));
  return message;
}

async function sendViaSes(options: EmailOptions): Promise<void> {
  const region = process.env.SES_REGION || process.env.AWS_REGION || 'us-east-2';
  const transport = nodemailer.createTransport({ SES: { sesClient: sesClient(region), SendEmailCommand } });
  // nodemailer copies `ses` onto the SendEmail request.
  const message: SendMailOptions & { ses?: { ConfigurationSetName: string } } = messageFrom(process.env.SES_FROM_EMAIL!, options);
  if (process.env.SES_CONFIGURATION_SET) message.ses = { ConfigurationSetName: process.env.SES_CONFIGURATION_SET };
  await transport.sendMail(message);
}

async function sendViaSmtp(options: EmailOptions): Promise<void> {
  const isSecure = Number(process.env.SMTP_PORT) === 465 || process.env.SMTP_SECURE === 'true';
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: isSecure,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  await transport.sendMail(messageFrom(process.env.SMTP_USER!, options));
}

export async function sendEmail(options: EmailOptions): Promise<EmailResult> {
  const { to } = options;
  const errorDetails: string[] = [];

  // 1. Amazon SES
  if (process.env.SES_FROM_EMAIL) {
    try {
      await sendViaSes(options);
      console.log(`✅ Email sent via SES to ${to}`);
      return { success: true, error: null, via: 'ses' };
    } catch (err) {
      const message = (err as Error).message;
      console.error(`⚠️ SES failed to send email to ${to}: ${message} — trying Gmail`);
      errorDetails.push(`SES error: ${message}`);
    }
  } else {
    errorDetails.push('SES not set up (SES_FROM_EMAIL)');
  }

  // 2. Gmail SMTP backup
  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    try {
      await sendViaSmtp(options);
      console.log(`✅ Email sent via SMTP to ${to}`);
      return { success: true, error: null, via: 'smtp' };
    } catch (smtpError) {
      console.error(`⚠️ SMTP failed to send email to ${to}: ${(smtpError as Error).message}`);
      errorDetails.push(`SMTP error: ${(smtpError as Error).message}`);
    }
  } else {
    errorDetails.push('SMTP auth details missing');
  }

  return { success: false, error: errorDetails.join(' | '), via: null };
}

// 1. Send Check-In Alert Notification
export async function sendCheckInAlertEmail(checkIn: Loose) {
  const { name, phone, email, fabricatorCompany, fabricatorPhone } = checkIn;
  
  const emailHtml = `
    <div style="font-family: sans-serif; max-width: 600px; padding: 20px; border: 1px solid #eaeaea; border-radius: 12px; background: #fafafa;">
      <h2 style="color: #d4af37; margin-top: 0;">Visitor Check-In Notification</h2>
      <p>A new visitor has checked in at the front desk office:</p>
      <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
        <tr>
          <td style="padding: 8px 0; font-weight: bold; color: #555; width: 180px;">Visitor Name:</td>
          <td style="padding: 8px 0; color: #222;">${escapeHtml(name)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-weight: bold; color: #555;">Phone Number:</td>
          <td style="padding: 8px 0; color: #222;">${escapeHtml(phone)}</td>
        </tr>
        ${email ? `
        <tr>
          <td style="padding: 8px 0; font-weight: bold; color: #555;">Email:</td>
          <td style="padding: 8px 0; color: #222;">${escapeHtml(email)}</td>
        </tr>
        ` : ''}
        <tr>
          <td style="padding: 8px 0; font-weight: bold; color: #555;">Company Name:</td>
          <td style="padding: 8px 0; color: #222;">${escapeHtml(fabricatorCompany) || 'N/A'}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-weight: bold; color: #555;">Company Phone:</td>
          <td style="padding: 8px 0; color: #222;">${escapeHtml(fabricatorPhone) || 'N/A'}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-weight: bold; color: #555;">Branch Location:</td>
          <td style="padding: 8px 0; color: #d4af37; font-weight: bold;">${escapeHtml(checkIn.location) || 'Seattle'}</td>
        </tr>
      </table>
      <hr style="border: 0; border-top: 1px solid #eaeaea; margin: 20px 0;" />
      <p style="font-size: 0.85rem; color: #888; margin: 0;">This is an automated notification from the Easy Stones Office Visitor App.</p>
    </div>
  `;

  const subject = `🔔 Front Desk Check-In Alert: ${name}`;

  // Priority routing: krish@easystones.com first, fallback to krisheasystones@gmail.com
  const sentToKrish = await sendEmail({
    to: 'krish@easystones.com',
    subject,
    html: emailHtml,
    defaultSenderName: `${SENDER_NAME} Check-In`
  });

  if (!sentToKrish.success) {
    console.log(`⚠️ Failed to send check-in alert to krish@easystones.com. Retrying fallback to krisheasystones@gmail.com...`);
    await sendEmail({
      to: 'krisheasystones@gmail.com',
      subject,
      html: emailHtml,
      defaultSenderName: `${SENDER_NAME} Check-In`
    });
  }
}

// 2. Send Selection Sheet Email
// The same sheet as the printed one (sheetDoc in src/utils/selectionSheet.ts —
// owner, 2026-11-07: "make the email template same as print template"), laid
// out for mail apps. `letterhead` is the check-in's location's address and
// phone (letterheadFor in src/utils/locationForm.ts; without one it's the Kent
// address). `showPrices` adds each material's Price / SF — always on for the
// sales rep's automatic copy, the main button for a fabricator, only on
// request for a home owner. `markUrl` is an absolute address of the gold mark
// (public/favicon.png); without one only the name shows. Internal notes are
// never in it.
//
// Dark mode (Outlook / Gmail on a phone repaint the email dark): the full logo
// image has dark lettering that vanished there, so the email shows the gold
// mark (transparent, reads on both) beside "EASY STONES" as text, which the
// mail app recolours with everything else. Phones and emails are our own
// links in the text's colour — left alone, phones turn them blue and
// underlined.
//
// Fluid at every width without media queries (many mail apps drop <style>),
// and built so a forward keeps it: the three people side by side while they
// fit (two and one on a phone); each material is one row — number, material and price,
// then Lot # / Slab # / Size (in), each under its own label — instead of a wide table that ran past a
// phone's edge. Outlook for Windows ignores max-width, so it gets a fixed
// 600px table in a conditional comment.
const SHEET_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function selectionSheetEmailHtml(checkIn: Loose, letterhead: Loose = DEFAULT_LETTERHEAD, { showPrices = false, markUrl = '' }: Loose = {}) {
  // The day on the branch's own clock (the server runs on UTC).
  const date = checkIn.createdAt
    ? new Date(checkIn.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: checkInZone(checkIn.location) })
    : '';
  const doc = sheetDoc({
    checkIn, rows: docRowsFromSelections(checkIn.selections), salesRep: checkIn.salesRep, salesRepEmail: checkIn.salesRepEmail,
    notes: checkIn.specialNotes, letterhead, date, showPrices: showPrices === true
  });
  const e = escapeHtml;
  const PEOPLE_SUB = '#3D434B';
  const LABEL = 'font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: #5B616B; white-space: nowrap;';
  const H2 = 'margin: 0; font-size: 16px; font-weight: 700; color: #1F2328;';
  const heading = [doc.date, doc.location].filter(Boolean).join(' · ');
  // A phone or email as a link in the surrounding text's colour, named
  // outright on the link and on a span inside it: a forward (Outlook's
  // editor) doesn't know `color: inherit` and turned them blue.
  const link = (href: string, text: string, color: string) =>
    `<a href="${href}" style="color: ${color}; text-decoration: none;"><span style="color: ${color};">${e(text)}</span></a>`;
  const phoneLink = (phone: string, color = PEOPLE_SUB) => {
    const digits = phone.replace(/\D/g, '');
    const tel = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith('1') ? `+${digits}` : '';
    return tel ? link(`tel:${tel}`, phone, color) : e(phone);
  };
  const emailLink = (email: string) => link(`mailto:${e(email)}`, email, PEOPLE_SUB);

  // The three people: blocks that sit side by side while they fit and wrap
  // when they don't — three across the 600px email, filling its width
  // (165 + 20 + 165 + 20, then the rep in the 188px left of the 558px
  // inside); on a phone each on its own line, so the rep's email has the
  // width to stay on one line (three phone-width columns broke it in two).
  // The rep, last, has no set width: it is as wide as its email, so a long
  // one moves under the other two instead of running past the card. They sit in a cell with
  // align="left" and are written with no space between them: a forward
  // (Outlook, Apple Mail) dropped our text-align and centred them, and a
  // space would add a gap. Labels are typed in capitals — a forward dropped
  // text-transform too. A forward also dropped the blocks' CSS widths and
  // bunched them on the left, so each holds a table whose width attribute
  // keeps the width.
  const person = (label: string, name: string, sub: string, width?: number) => `<div style="display: inline-block; vertical-align: top;${width ? ` width: ${width}px;` : ''} max-width: 100%; margin: 0 ${width ? 20 : 0}px 14px 0; text-align: left;">`
    + `<table role="presentation"${width ? ` width="${width}"` : ''} cellpadding="0" cellspacing="0" border="0" style="${width ? `width: ${width}px; ` : ''}max-width: 100%; border-collapse: collapse;"><tr><td align="left" style="padding: 0; text-align: left;">`
    + `<div style="${LABEL}">${label}</div>`
    + `<div style="margin-top: 3px; font-size: 15px; font-weight: 600; color: #1F2328; word-break: break-word; overflow-wrap: anywhere;">${e(name) || '—'}</div>`
    + (sub ? (sub.includes('@')
      ? `<div style="margin-top: 1px; font-size: 13px; color: ${PEOPLE_SUB}; white-space: nowrap;">${emailLink(sub)}</div>`
      : `<div style="margin-top: 1px; font-size: 13px; color: ${PEOPLE_SUB}; white-space: nowrap;">${phoneLink(sub)}</div>`) : '')
    + '</td></tr></table></div>';

  const rowsHtml = doc.rows.length === 0
    ? '<p style="margin: 0; padding: 14px 0; text-align: center; color: #5B616B; font-style: italic; font-size: 14px; border-bottom: 1px solid #D9D4C7;">No selections registered.</p>'
    : doc.rows.map((r, i) => {
      // Each figure under its own small label (Lot # / Slab # / Size (in)) —
      // "Lot 14873 · Slabs 7 · 126 * 63 in" read as one run of numbers.
      // Blocks side by side that wrap on a narrow phone, no space between them.
      const fact = (label: string, value: string) => `<div style="display: inline-block; vertical-align: top; margin: 0 22px 4px 0;">`
        + `<div style="font-size: 10px; font-weight: 700; letter-spacing: 0.06em; color: #5B616B; white-space: nowrap;">${e(label.toUpperCase())}</div>`
        + `<div style="margin-top: 1px; font-size: 14px; color: #1F2328; white-space: nowrap;">${e(value)}</div></div>`;
      const facts = [r.lot && fact(SHEET_LABELS.lot, r.lot), r.details && fact(SHEET_LABELS.slabs, r.details), r.size && fact(SHEET_LABELS.size, r.size)].filter(Boolean).join('');
      return `
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse; border-bottom: 1px solid #D9D4C7;">
            <tr>
              <td style="width: 22px; padding: 12px 0 0 0; vertical-align: top; font-size: 15px; font-weight: 700; color: #7A5C10;">${i + 1}</td>
              <td style="padding: 12px 0 0 0; vertical-align: top; font-size: 15px; font-weight: 600; letter-spacing: 0.02em; color: #1F2328; word-break: break-word; overflow-wrap: anywhere;">${e(r.material) || '—'}</td>
              ${doc.showPrices ? `<td style="padding: 12px 0 0 12px; vertical-align: top; text-align: right; white-space: nowrap; width: 1%; font-size: ${r.priceCents ? '15px; font-weight: 700; color: #1F2328' : '13px; color: #5B616B'};">${e(sheetPriceLabel(r.priceCents))}${r.priceCents ? '&nbsp;<span style="font-size: 12px; font-weight: 400; color: #5B616B; white-space: nowrap;">/SF</span>' : ''}</td>` : ''}
            </tr>
            <tr>
              <td></td>
              <td colspan="${doc.showPrices ? 2 : 1}" align="left" style="padding: 6px 0 10px 0; text-align: left;">${facts || '&nbsp;'}</td>
            </tr>
          </table>`;
    }).join('');

  // Each step's number in a ring. The ring is a table cell sized by its
  // width / height attributes, not a sized <div>: a forward dropped the
  // div's size and the ring stretched across its column into the words.
  // The words have their own left padding so they never touch it. (Outlook
  // on Windows draws no border-radius: a square there.)
  const steps = doc.steps.map((t, i) => `
              <tr>
                <td width="22" style="width: 22px; padding: 6px 0 0 0; vertical-align: top;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse: separate;"><tr><td width="20" height="20" align="center" valign="middle" style="width: 20px; height: 20px; padding: 0; border: 1px solid #7A5C10; border-radius: 11px; color: #7A5C10; font-size: 12px; line-height: 20px; font-weight: 700; text-align: center;">${i + 1}</td></tr></table></td>
                <td style="padding: 8px 0 0 10px; vertical-align: top; font-size: 13px; line-height: 1.45; color: #1F2328;">${e(t)}</td>
              </tr>`).join('');

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse;">
    <tr><td align="center" style="padding: 0;">
    <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
    <div style="max-width: 600px; margin: 0 auto; box-sizing: border-box; padding: 24px 20px; border: 1px solid #E3DED2; border-radius: 12px; background: #ffffff; font-family: ${SHEET_FONT}; color: #1F2328; text-align: left; line-height: 1.4;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="vertical-align: bottom; padding: 0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
              <tr>
                ${markUrl ? `<td style="vertical-align: middle; padding: 0 8px 0 0;"><img src="${e(markUrl)}" alt="" width="20" height="26" style="display: block; width: 20px; height: 26px; border: 0;"></td>` : ''}
                <td style="vertical-align: middle; padding: 0; font-size: 13px; font-weight: 600; letter-spacing: 0.14em; color: #1F2328; white-space: nowrap;">EASY STONES</td>
              </tr>
            </table>
          </td>
          <td style="vertical-align: bottom; padding: 0 0 0 12px; text-align: right;">
            <div style="font-size: 18px; font-weight: 700; color: #1F2328; white-space: nowrap;">Stone Selection</div>
            ${heading ? `<div style="margin-top: 2px; font-size: 13px; color: #5B616B; white-space: nowrap;">${e(heading)}</div>` : ''}
          </td>
        </tr>
      </table>
      <div style="height: 2px; line-height: 2px; font-size: 0; background: #C9A13B; margin: 16px 0 20px 0;">&nbsp;</div>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse;">
        <tr><td align="left" style="padding: 0; text-align: left;">${person('PREPARED FOR', doc.customer.name, doc.customer.phone, 165)}${person('FABRICATOR', doc.fabricator.name, doc.fabricator.phone, 165)}${person('YOUR SALES REP', doc.rep.name, doc.rep.email)}</td></tr>
      </table>

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse; margin-top: 26px;">
        <tr>
          <td style="padding: 0 0 8px 0;"><div style="${H2}">Your selections</div></td>
          <td style="padding: 0 0 8px 0; text-align: right; font-size: 13px; color: #5B616B; white-space: nowrap;">${e(doc.count)}</td>
        </tr>
      </table>
      <div style="border-top: 1px solid #1F2328;">${rowsHtml}
      </div>
      ${doc.showPrices ? `<p style="margin: 8px 0 0 0; font-size: 12px; color: #5B616B;">Prices per square foot, as quoted on ${e(doc.date)}.</p>` : ''}

      ${doc.notes ? `
      <div style="margin-top: 22px;">
        <div style="${H2}">Notes</div>
        <p style="margin: 6px 0 0 0; font-size: 15px; line-height: 1.55; color: #1F2328; white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere;">${e(doc.notes)}</p>
      </div>` : ''}

      <div style="margin-top: 24px; border: 1px solid #D9C27A; border-radius: 12px; padding: 16px 18px; background: #FBF8EF;">
        <div style="${H2}">Hold Policy</div>
        <p style="margin: 4px 0 0 0; font-size: 13px; line-height: 1.55; color: #3D434B;">${e(HOLD_POLICY)}</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse; margin-top: 10px; border-top: 1px solid #E6DAB3;">${steps}
        </table>
      </div>

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse; margin-top: 24px; border-top: 1px solid #D9D4C7;">
        <tr>
          <td style="padding: 12px 12px 0 0; vertical-align: top; font-size: 12px; line-height: 1.6; color: #5B616B;">${e(doc.footer)}</td>
          <td style="padding: 12px 0 0 0; vertical-align: top; text-align: right; white-space: nowrap; font-size: 12px; line-height: 1.6; color: #5B616B;">${phoneLink(doc.phone, '#5B616B')}</td>
        </tr>
      </table>
    </div>
    <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
  `;
}

export async function sendSelectionSheetEmail(checkIn: Loose, recipientEmail: string, letterhead: Loose = DEFAULT_LETTERHEAD, { showPrices = false, markUrl = '' }: Loose = {}) {
  const repEmail = String(checkIn.salesRepEmail || '').trim();
  return await sendEmail({
    to: recipientEmail,
    subject: `Selection Sheet: ${checkIn.name}`,
    html: selectionSheetEmailHtml(checkIn, letterhead, { showPrices, markUrl }),
    // Sent as plain "Easy Stones" (owner, 2026-11-07); replies still go to the rep.
    defaultSenderName: SENDER_NAME,
    ...(checkIn.salesRep && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(repEmail) ? { replyTo: repEmail } : {})
  });
}

// 3. Send Website Contact Form Alert Email
export async function sendContactFormEmail(contactSubmission: Loose) {
  const { name, company, email, phone, message } = contactSubmission;
  
  const rawRecipients = process.env.CONTACT_ALERT_EMAIL || process.env.CHECKIN_ALERT_EMAIL || 'krish@easystones.com, krisheasystones@gmail.com';
  const recipients = rawRecipients.split(',').map(e => e.trim()).filter(Boolean);

  const emailHtml = `
    <div style="font-family: sans-serif; max-width: 600px; padding: 20px; border: 1px solid #eaeaea; border-radius: 12px; background: #fafafa;">
      <h2 style="color: #d4af37; margin-top: 0;">New Contact Form Message</h2>
      <p>You have received a new message from the website contact form:</p>
      <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
        <tr>
          <td style="padding: 8px 0; font-weight: bold; color: #555; width: 150px;">Name:</td>
          <td style="padding: 8px 0; color: #222;">${name}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-weight: bold; color: #555;">Company:</td>
          <td style="padding: 8px 0; color: #222;">${company || 'N/A'}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-weight: bold; color: #555;">Email:</td>
          <td style="padding: 8px 0; color: #222;"><a href="mailto:${email}">${email}</a></td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-weight: bold; color: #555;">Phone:</td>
          <td style="padding: 8px 0; color: #222;">${phone || 'N/A'}</td>
        </tr>
      </table>
      <div style="margin-top: 15px; padding: 15px; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h4 style="margin: 0 0 10px 0; color: #475569;">Message:</h4>
        <p style="margin: 0; color: #334155; white-space: pre-wrap; line-height: 1.5;">${message}</p>
      </div>
      <hr style="border: 0; border-top: 1px solid #eaeaea; margin: 20px 0;" />
      <p style="font-size: 0.85rem; color: #888; margin: 0;">This is an automated notification from the Easy Stones Website.</p>
    </div>
  `;

  const subject = `📩 Contact Form Message from ${name}`;

  let sent = false;

  for (const recipient of recipients) {
    const success = await sendEmail({
      to: recipient,
      subject,
      html: emailHtml,
      replyTo: email,
      defaultSenderName: `${SENDER_NAME} Contact`
    });
    if (success) {
      sent = true;
    }
  }

  return sent;
}
