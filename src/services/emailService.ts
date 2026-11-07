import type { Loose } from '../types/records.ts';
import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import type { CreateEmailOptions } from 'resend';
import type { SendMailOptions } from 'nodemailer';
import { DEFAULT_LETTERHEAD } from '../utils/locationForm.ts';
import { sheetDoc, docRowsFromSelections, sheetPriceLabel, HOLD_POLICY } from '../utils/selectionSheet.ts';
import { checkInZone } from '../utils/checkInClock.ts';

// The check-in emails below interpolate visitor-supplied fields (name, notes,
// selections...) straight into HTML. The self check-in endpoint that produces
// most of that data requires no login, so an unescaped field is an open door
// to email HTML/phishing-content injection (spoofed links, tracking pixels,
// broken layout) landing in a staff inbox.
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[ch]!));

// Helper to send general mail using Resend API with SMTP fallback
/**
 * `attachments` is [{ filename, content }] where content is a Buffer or
 * Uint8Array. Resend wants base64, nodemailer wants the Buffer — the two
 * transports are fed accordingly rather than making callers care.
 */
type EmailOptions = {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
  defaultSenderName?: string;
  attachments?: { filename: string; content: Uint8Array }[];
};

export async function sendEmail({ to, subject, html, replyTo, defaultSenderName, attachments = [] }: EmailOptions) {
  let sent = false;
  const errorDetails: string[] = [];

  // 1. Try Resend
  if (process.env.RESEND_API_KEY) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
      const payload: CreateEmailOptions = {
        from: `${defaultSenderName} <${fromEmail}>`,
        to: Array.isArray(to) ? to : [to],
        subject,
        html
      };
      if (replyTo) {
        payload.replyTo = replyTo;
      }
      if (attachments.length) {
        payload.attachments = attachments.map(a => ({
          filename: a.filename,
          content: Buffer.from(a.content).toString('base64')
        }));
      }

      const {  error } = await resend.emails.send(payload);
      if (error) {
        const errMsg = error.message || JSON.stringify(error);
        console.error(`⚠️ Resend failed to send email to ${to}: ${errMsg}`);
        errorDetails.push(`Resend error: ${errMsg}`);
      } else {
        sent = true;
        console.log(`✅ Email sent via Resend to ${to}`);
      }
    } catch (err) {
      console.error(`⚠️ Resend exception sending email to ${to}: ${(err as Error).message}`);
      errorDetails.push(`Resend exception: ${(err as Error).message}`);
    }
  } else {
    errorDetails.push('Resend API key missing');
  }

  // 2. Try SMTP Fallback
  if (!sent) {
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      try {
        const isSecure = Number(process.env.SMTP_PORT) === 465 || process.env.SMTP_SECURE === 'true';
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST || 'smtp.gmail.com',
          port: Number(process.env.SMTP_PORT) || 587,
          secure: isSecure,
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
          }
        });

        const payload: SendMailOptions = {
          from: `"${defaultSenderName}" <${process.env.SMTP_USER}>`,
          to: Array.isArray(to) ? to.join(', ') : to,
          subject,
          html
        };
        if (replyTo) {
          payload.replyTo = replyTo;
        }
        if (attachments.length) {
          payload.attachments = attachments.map(a => ({
            filename: a.filename,
            content: Buffer.from(a.content)
          }));
        }

        await transporter.sendMail(payload);
        sent = true;
        console.log(`✅ Email sent via SMTP to ${to}`);
      } catch (smtpError) {
        console.error(`⚠️ SMTP failed to send email to ${to}: ${(smtpError as Error).message}`);
        errorDetails.push(`SMTP error: ${(smtpError as Error).message}`);
      }
    } else {
      errorDetails.push('SMTP auth details missing');
    }
  }

  return {
    success: sent,
    error: sent ? null : errorDetails.join(' | ')
  };
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
    defaultSenderName: 'Easy Stones Check-In'
  });

  if (!sentToKrish.success) {
    console.log(`⚠️ Failed to send check-in alert to krish@easystones.com. Retrying fallback to krisheasystones@gmail.com...`);
    await sendEmail({
      to: 'krisheasystones@gmail.com',
      subject,
      html: emailHtml,
      defaultSenderName: 'Easy Stones Check-In'
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
// request for a home owner. `logoUrl` is an absolute address of the logo;
// without one the name shows as text. Internal notes are never in it.
//
// Fluid at every width without media queries (many mail apps drop <style>),
// and built from tables so a forward keeps it: the three people side by side
// at every width; each material is one row — number, material and price,
// then lot · slabs · size under it — instead of a wide table that ran past a
// phone's edge. Outlook for Windows ignores max-width, so it gets a fixed
// 600px table in a conditional comment.
const SHEET_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function selectionSheetEmailHtml(checkIn: Loose, letterhead: Loose = DEFAULT_LETTERHEAD, { showPrices = false, logoUrl = '' }: Loose = {}) {
  // The day on the branch's own clock (the server runs on UTC).
  const date = checkIn.createdAt
    ? new Date(checkIn.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: checkInZone(checkIn.location) })
    : '';
  const doc = sheetDoc({
    checkIn, rows: docRowsFromSelections(checkIn.selections), salesRep: checkIn.salesRep, salesRepEmail: checkIn.salesRepEmail,
    notes: checkIn.specialNotes, letterhead, date, showPrices: showPrices === true
  });
  const e = escapeHtml;
  const LABEL = 'font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: #5B616B; white-space: nowrap;';
  const H2 = 'margin: 0; font-size: 16px; font-weight: 700; color: #1F2328;';
  const heading = [doc.date, doc.location].filter(Boolean).join(' · ');

  // The three people are one table row of three cells — a table survives a
  // forward (Outlook's and Apple Mail's forwards dropped the inline-block
  // layout and its text-align, and centred the blocks). Labels are written in
  // capitals rather than styled so, which a forward also dropped. An email
  // address may break after its "@" in a narrow cell.
  // The rep's column is a little wider: "YOUR SALES REP" and an email
  // address are the longest, and on a phone they'd wrap first.
  const person = (label: string, name: string, sub: string, last = false) => `
          <td width="${last ? 36 : 32}%" valign="top" align="left" style="width: ${last ? 36 : 32}%; padding: 0 ${last ? '0' : '8px'} 0 0; vertical-align: top; text-align: left;">
            <div style="${LABEL}">${label}</div>
            <div style="margin-top: 3px; font-size: 15px; font-weight: 600; color: #1F2328; word-break: break-word; overflow-wrap: anywhere;">${e(name) || '—'}</div>
            ${sub ? (sub.includes('@')
              ? `<div style="margin-top: 1px; font-size: 13px; color: #3D434B; word-break: break-word; overflow-wrap: anywhere;">${e(sub).replace('@', '@<wbr>')}</div>`
              : `<div style="margin-top: 1px; font-size: 13px; color: #3D434B; white-space: nowrap;">${e(sub)}</div>`) : ''}
          </td>`;

  const rowsHtml = doc.rows.length === 0
    ? '<p style="margin: 0; padding: 14px 0; text-align: center; color: #5B616B; font-style: italic; font-size: 14px; border-bottom: 1px solid #D9D4C7;">No selections registered.</p>'
    : doc.rows.map((r, i) => {
      const facts = [r.lot && `Lot ${r.lot}`, r.details && `Slabs ${r.details}`, r.size && `${r.size} in`].filter(Boolean).map((f) => e(f)).join(' &middot; ');
      return `
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse; border-bottom: 1px solid #D9D4C7;">
            <tr>
              <td style="width: 22px; padding: 12px 0 0 0; vertical-align: top; font-size: 15px; font-weight: 700; color: #7A5C10;">${i + 1}</td>
              <td style="padding: 12px 0 0 0; vertical-align: top; font-size: 15px; font-weight: 600; letter-spacing: 0.02em; color: #1F2328; word-break: break-word; overflow-wrap: anywhere;">${e(r.material) || '—'}</td>
              ${doc.showPrices ? `<td style="padding: 12px 0 0 12px; vertical-align: top; text-align: right; white-space: nowrap; width: 1%; font-size: ${r.priceCents ? '15px; font-weight: 700; color: #1F2328' : '13px; color: #5B616B'};">${e(sheetPriceLabel(r.priceCents))}${r.priceCents ? '&nbsp;<span style="font-size: 12px; font-weight: 400; color: #5B616B; white-space: nowrap;">/SF</span>' : ''}</td>` : ''}
            </tr>
            <tr>
              <td></td>
              <td colspan="${doc.showPrices ? 2 : 1}" style="padding: 3px 0 12px 0; font-size: 14px; color: #3D434B; word-break: break-word; overflow-wrap: anywhere;">${facts || '&nbsp;'}</td>
            </tr>
          </table>`;
    }).join('');

  const steps = doc.steps.map((t, i) => `
              <tr>
                <td style="width: 30px; padding: 6px 0 0 0; vertical-align: top;"><div style="width: 20px; height: 20px; line-height: 20px; border-radius: 10px; border: 1px solid #7A5C10; color: #7A5C10; font-size: 12px; font-weight: 700; text-align: center;">${i + 1}</div></td>
                <td style="padding: 7px 0 0 0; vertical-align: top; font-size: 13px; line-height: 1.45; color: #1F2328;">${e(t)}</td>
              </tr>`).join('');

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse;">
    <tr><td align="center" style="padding: 0;">
    <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
    <div style="max-width: 600px; margin: 0 auto; box-sizing: border-box; padding: 24px 20px; border: 1px solid #E3DED2; border-radius: 12px; background: #ffffff; font-family: ${SHEET_FONT}; color: #1F2328; text-align: left; line-height: 1.4;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="vertical-align: bottom; padding: 0;">${logoUrl
            ? `<img src="${e(logoUrl)}" alt="Easy Stones" height="32" style="display: block; height: 32px; width: auto; max-width: 140px; border: 0;">`
            : '<div style="font-size: 20px; font-weight: 800; letter-spacing: 0.12em; color: #1F2328;">EASY STONES</div>'}</td>
          <td style="vertical-align: bottom; padding: 0 0 0 12px; text-align: right;">
            <div style="font-size: 19px; font-weight: 700; color: #1F2328; white-space: nowrap;">Stone Selection</div>
            ${heading ? `<div style="margin-top: 2px; font-size: 13px; color: #5B616B; white-space: nowrap;">${e(heading)}</div>` : ''}
          </td>
        </tr>
      </table>
      <div style="height: 2px; line-height: 2px; font-size: 0; background: #C9A13B; margin: 16px 0 20px 0;">&nbsp;</div>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse; table-layout: fixed;">
        <tr>${person('PREPARED FOR', doc.customer.name, doc.customer.phone)}${person('FABRICATOR', doc.fabricator.name, doc.fabricator.phone)}${person('YOUR SALES REP', doc.rep.name, doc.rep.email, true)}
        </tr>
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
          <td style="padding: 12px 0 0 0; vertical-align: top; text-align: right; white-space: nowrap; font-size: 12px; line-height: 1.6; color: #5B616B;">${e(doc.phone)}</td>
        </tr>
      </table>
    </div>
    <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
  `;
}

export async function sendSelectionSheetEmail(checkIn: Loose, recipientEmail: string, letterhead: Loose = DEFAULT_LETTERHEAD, { showPrices = false, logoUrl = '' }: Loose = {}) {
  const repEmail = String(checkIn.salesRepEmail || '').trim();
  return await sendEmail({
    to: recipientEmail,
    subject: `Selection Sheet: ${checkIn.name}`,
    html: selectionSheetEmailHtml(checkIn, letterhead, { showPrices, logoUrl }),
    // Sent as plain "Easy Stones" (owner, 2026-11-07); replies still go to the rep.
    defaultSenderName: 'Easy Stones',
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
      defaultSenderName: 'Easy Stones Contact'
    });
    if (success) {
      sent = true;
    }
  }

  return sent;
}
