import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import { DEFAULT_LETTERHEAD } from '../utils/locationForm.js';
import { formatSheetPrice, formatSlabSize } from '../utils/selectionSheet.js';

// The check-in emails below interpolate visitor-supplied fields (name, notes,
// selections...) straight into HTML. The self check-in endpoint that produces
// most of that data requires no login, so an unescaped field is an open door
// to email HTML/phishing-content injection (spoofed links, tracking pixels,
// broken layout) landing in a staff inbox.
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[ch]));

// Helper to send general mail using Resend API with SMTP fallback
/**
 * `attachments` is [{ filename, content }] where content is a Buffer or
 * Uint8Array. Resend wants base64, nodemailer wants the Buffer — the two
 * transports are fed accordingly rather than making callers care.
 */
export async function sendEmail({ to, subject, html, replyTo, defaultSenderName, attachments = [] }) {
  let sent = false;
  let errorDetails = [];

  // 1. Try Resend
  if (process.env.RESEND_API_KEY) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
      const payload = {
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
      console.error(`⚠️ Resend exception sending email to ${to}: ${err.message}`);
      errorDetails.push(`Resend exception: ${err.message}`);
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

        const payload = {
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
        console.error(`⚠️ SMTP failed to send email to ${to}: ${smtpError.message}`);
        errorDetails.push(`SMTP error: ${smtpError.message}`);
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
export async function sendCheckInAlertEmail(checkIn) {
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
// `letterhead` is the check-in's location's address/contact lines
// (letterheadFor in src/utils/locationForm.js); without one it's the Kent address.
// `showPrices` adds each material's Price / SF — always on for the sales rep's
// automatic copy, only on request for anyone else. Internal notes are never in it.
//
// Fluid at every width without media queries (many mail apps drop <style>):
// one card per material instead of a 6-column table, which on a phone ran
// past the email's right edge. Outlook for Windows ignores max-width, so it
// gets a fixed 640px table in a conditional comment.
const SHEET_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function selectionSheetEmailHtml(checkIn, letterhead = DEFAULT_LETTERHEAD, { showPrices = false } = {}) {
  const dateStr = new Date(checkIn.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  const selections = checkIn.selections || [];

  const detail = (label, value, strong = false) => `
          <tr>
            <td style="padding: 5px 14px 5px 0; font-weight: 700; color: #555; font-size: 13px; white-space: nowrap; vertical-align: top; width: 1%;">${label}</td>
            <td style="padding: 5px 0; color: #222; font-size: 14px; vertical-align: top; word-break: break-word; overflow-wrap: anywhere;${strong ? ' font-weight: 600;' : ''}">${value}</td>
          </tr>`;

  const fact = (label, value) => `
              <div style="display: inline-block; vertical-align: top; margin: 0 22px 6px 0;">
                <div style="font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: #64748b;">${label}</div>
                <div style="font-size: 14px; color: #334155; white-space: nowrap;">${value || 'N/A'}</div>
              </div>`;

  const selectionsHtml = selections.length === 0
    ? '<p style="margin: 0 0 16px 0; padding: 14px; text-align: center; color: #666; font-style: italic; font-size: 14px; background: #fff; border: 1px solid #eaeaea; border-radius: 10px;">No selections registered.</p>'
    : selections.map((sel, idx) => `
        <div style="background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px 14px 8px 14px; margin: 0 0 10px 0;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="vertical-align: top; padding: 0 0 8px 0; font-size: 15px; font-weight: 700; color: #111; word-break: break-word; overflow-wrap: anywhere;">
                <span style="color: #b8941f; margin-right: 6px;">${idx + 1}.</span>${escapeHtml(sel.material) || 'N/A'}
              </td>
              ${showPrices ? `<td style="vertical-align: top; padding: 0 0 8px 12px; text-align: right; white-space: nowrap; width: 1%;">
                <div style="font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: #64748b;">Price / SF</div>
                <div style="font-size: 15px; font-weight: 700; color: #111;">${escapeHtml(formatSheetPrice(sel.priceCentsPerSf))}</div>
              </td>` : ''}
            </tr>
          </table>
          <div>${fact('Lot / Bundle', escapeHtml(sel.lot))}${fact('Slabs', escapeHtml(sel.details))}${fact('Size', escapeHtml(formatSlabSize(sel.size)))}
          </div>
        </div>`).join('');

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse;">
    <tr><td align="center" style="padding: 0;">
    <!--[if mso]><table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
    <div style="max-width: 640px; margin: 0 auto; box-sizing: border-box; padding: 20px 16px; border: 1px solid #e2e8f0; border-radius: 14px; background: #fafafa; font-family: ${SHEET_FONT}; text-align: left; line-height: 1.4;">
      <div style="text-align: center; border-bottom: 2px solid #d4af37; padding-bottom: 14px; margin-bottom: 18px;">
        <div style="color: #111; font-weight: 800; letter-spacing: 0.05em; font-size: 24px;">EASY STONES</div>
        <p style="color: #666; margin: 5px 0 0 0; font-size: 13px;">${escapeHtml(letterhead.addressLine)}</p>
        ${letterhead.contactLine ? `<p style="color: #666; margin: 2px 0 0 0; font-size: 12px;">${escapeHtml(letterhead.contactLine)}</p>` : ''}
      </div>

      <div style="color: #b8941f; text-align: center; margin: 0 0 18px 0; font-size: 16px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;">
        Customer Visit / Stone Selection
      </div>

      <div style="background: #fff; border: 1px solid #eaeaea; border-radius: 12px; padding: 10px 14px; margin-bottom: 20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse;">
          ${detail('Date', dateStr)}
          ${detail('Customer', escapeHtml(checkIn.name), true)}
          ${detail('Phone', escapeHtml(checkIn.phone))}
          ${detail('Company', escapeHtml(checkIn.fabricatorCompany) || 'N/A')}
          ${detail('Company phone', escapeHtml(checkIn.fabricatorPhone) || 'N/A')}
          ${checkIn.salesRep ? detail('Sales rep', escapeHtml(checkIn.salesRep), true) : ''}
        </table>
      </div>

      <div style="color: #111; margin: 0 0 10px 0; font-size: 16px; font-weight: 700; border-left: 3px solid #d4af37; padding-left: 8px;">Material Selection(s)</div>
      ${selectionsHtml}

      ${checkIn.specialNotes ? `
      <div style="background: #fff; border: 1px solid #eaeaea; border-radius: 12px; padding: 12px 14px; margin: 10px 0 16px 0;">
        <div style="margin: 0 0 6px 0; color: #475569; font-size: 14px; font-weight: 700;">Notes</div>
        <p style="margin: 0; color: #334155; font-size: 14px; white-space: pre-wrap; line-height: 1.5; word-break: break-word; overflow-wrap: anywhere;">${escapeHtml(checkIn.specialNotes)}</p>
      </div>
      ` : ''}

      <div style="background: #fef2f2; border: 1px dashed #fca5a5; border-radius: 12px; padding: 12px 14px; margin: 10px 0 15px 0;">
        <p style="margin: 0; font-size: 13px; color: #b91c1c; line-height: 1.5;">
          <strong>Hold Policy Note:</strong> Items will not automatically be held. Once a final selection is made, you or your fabricator may choose to hold under the fabricator's account for 7 days. After 7 days, tags may be removed without notice to you or your fabricator.
        </p>
      </div>

      <hr style="border: 0; border-top: 1px solid #eaeaea; margin: 18px 0;" />
      <p style="font-size: 12px; color: #888; text-align: center; margin: 0;">This is an automated notification from the Easy Stones Check-In Portal.</p>
    </div>
    <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
  `;
}

export async function sendSelectionSheetEmail(checkIn, recipientEmail, letterhead = DEFAULT_LETTERHEAD, { showPrices = false } = {}) {
  return await sendEmail({
    to: recipientEmail,
    subject: `🪨 Stone Selection Sheet: ${checkIn.name}`,
    html: selectionSheetEmailHtml(checkIn, letterhead, { showPrices }),
    defaultSenderName: 'Easy Stones Selection'
  });
}

// 3. Send Website Contact Form Alert Email
export async function sendContactFormEmail(contactSubmission) {
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
