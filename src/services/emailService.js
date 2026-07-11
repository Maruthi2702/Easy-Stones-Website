import nodemailer from 'nodemailer';
import { Resend } from 'resend';

// Helper to send general mail using Resend API with SMTP fallback
export async function sendEmail({ to, subject, html, replyTo, defaultSenderName }) {
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
      
      const { data, error } = await resend.emails.send(payload);
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
  const { name, phone, email, fabricatorCompany, fabricatorPhone, fabricatorName } = checkIn;
  
  const emailHtml = `
    <div style="font-family: sans-serif; max-width: 600px; padding: 20px; border: 1px solid #eaeaea; border-radius: 12px; background: #fafafa;">
      <h2 style="color: #d4af37; margin-top: 0;">Visitor Check-In Notification</h2>
      <p>A new visitor has checked in at the front desk office:</p>
      <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
        <tr>
          <td style="padding: 8px 0; font-weight: bold; color: #555; width: 180px;">Visitor Name:</td>
          <td style="padding: 8px 0; color: #222;">${name}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-weight: bold; color: #555;">Phone Number:</td>
          <td style="padding: 8px 0; color: #222;">${phone}</td>
        </tr>
        ${email ? `
        <tr>
          <td style="padding: 8px 0; font-weight: bold; color: #555;">Email:</td>
          <td style="padding: 8px 0; color: #222;">${email}</td>
        </tr>
        ` : ''}
        <tr>
          <td style="padding: 8px 0; font-weight: bold; color: #555;">Company Name:</td>
          <td style="padding: 8px 0; color: #222;">${fabricatorCompany || 'N/A'}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-weight: bold; color: #555;">Company Phone:</td>
          <td style="padding: 8px 0; color: #222;">${fabricatorPhone || 'N/A'}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-weight: bold; color: #555;">Contact Name:</td>
          <td style="padding: 8px 0; color: #222;">${fabricatorName || 'N/A'}</td>
        </tr>
      </table>
      <hr style="border: 0; border-top: 1px solid #eaeaea; margin: 20px 0;" />
      <p style="font-size: 0.85rem; color: #888; margin: 0;">This is an automated notification from the Easy Stones Office Visitor App.</p>
    </div>
  `;

  const subject = `🔔 Front Desk Check-In Alert: ${name}`;

  // Priority routing: krish@easystones.com first, fallback to ponugupatimaruthi@gmail.com
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
export async function sendSelectionSheetEmail(checkIn, recipientEmail) {
  const dateStr = new Date(checkIn.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

  let selectionsHtml = '';
  const selections = checkIn.selections || [];
  if (selections.length === 0) {
    selectionsHtml = `
      <tr>
        <td colspan="5" style="padding: 12px 10px; text-align: center; color: #666; font-style: italic;">No selections registered.</td>
      </tr>
    `;
  } else {
    selections.forEach((sel, idx) => {
      selectionsHtml += `
        <tr style="border-bottom: 1px solid #eaeaea;">
          <td style="padding: 10px; text-align: center; color: #d4af37; font-weight: bold;">${idx + 1}</td>
          <td style="padding: 10px; color: #222; font-weight: 500;">${sel.material || 'N/A'}</td>
          <td style="padding: 10px; color: #555;">${sel.lot || 'N/A'}</td>
          <td style="padding: 10px; color: #555;">${sel.details || 'N/A'}</td>
          <td style="padding: 10px; color: #555;">${sel.size || 'N/A'}</td>
        </tr>
      `;
    });
  }

  const emailHtml = `
    <div style="font-family: sans-serif; max-width: 700px; padding: 25px; border: 1px solid #e2e8f0; border-radius: 16px; background: #fafafa;">
      <div style="text-align: center; border-bottom: 2px solid #d4af37; padding-bottom: 15px; margin-bottom: 20px;">
        <h2 style="color: #111; margin: 0; font-weight: 800; letter-spacing: 0.05em; font-size: 1.6rem;">EASY STONES</h2>
        <p style="color: #666; margin: 5px 0 0 0; font-size: 0.85rem;">6012 S 196th St, Kent, WA 98032</p>
      </div>
      
      <h3 style="color: #d4af37; text-align: center; margin: 0 0 20px 0; font-size: 1.15rem; letter-spacing: 0.05em; text-transform: uppercase;">
        Customer Visit / Stone Selection
      </h3>
      
      <div style="background: #fff; border: 1px solid #eaeaea; border-radius: 12px; padding: 15px; margin-bottom: 20px;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 6px 0; font-weight: bold; color: #555; width: 180px; font-size: 0.85rem;">Date:</td>
            <td style="padding: 6px 0; color: #222; font-size: 0.9rem;">${dateStr}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; font-weight: bold; color: #555; font-size: 0.85rem;">Customer Name:</td>
            <td style="padding: 6px 0; color: #222; font-size: 0.9rem; font-weight: 600;">${checkIn.name}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; font-weight: bold; color: #555; font-size: 0.85rem;">Phone Number:</td>
            <td style="padding: 6px 0; color: #222; font-size: 0.9rem;">${checkIn.phone}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; font-weight: bold; color: #555; font-size: 0.85rem;">Company Name:</td>
            <td style="padding: 6px 0; color: #222; font-size: 0.9rem;">${checkIn.fabricatorCompany || 'N/A'}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; font-weight: bold; color: #555; font-size: 0.85rem;">Company Phone:</td>
            <td style="padding: 6px 0; color: #222; font-size: 0.9rem;">${checkIn.fabricatorPhone || 'N/A'}</td>
          </tr>
          ${checkIn.salesRep ? `
          <tr>
            <td style="padding: 6px 0; font-weight: bold; color: #555; font-size: 0.85rem;">Sales Rep:</td>
            <td style="padding: 6px 0; color: #222; font-size: 0.9rem; font-weight: 600;">${checkIn.salesRep}</td>
          </tr>
          ` : ''}
        </table>
      </div>
      
      <h4 style="color: #111; margin: 0 0 10px 0; font-size: 1rem; border-left: 3px solid #d4af37; padding-left: 8px;">Material Selection(s)</h4>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 0.85rem;">
        <thead>
          <tr style="background: #f1f5f9; border-bottom: 2px solid #e2e8f0;">
            <th style="padding: 8px 10px; text-align: center; font-weight: bold; color: #475569; width: 5%;">#</th>
            <th style="padding: 8px 10px; text-align: left; font-weight: bold; color: #475569;">Material Name</th>
            <th style="padding: 8px 10px; text-align: left; font-weight: bold; color: #475569;">Lot/Bundle Number</th>
            <th style="padding: 8px 10px; text-align: left; font-weight: bold; color: #475569;">Slab Numbers</th>
            <th style="padding: 8px 10px; text-align: left; font-weight: bold; color: #475569;">Size</th>
          </tr>
        </thead>
        <tbody>
          ${selectionsHtml}
        </tbody>
      </table>
      
      ${checkIn.specialNotes ? `
      <div style="background: #fff; border: 1px solid #eaeaea; border-radius: 12px; padding: 15px; margin-bottom: 20px;">
        <h4 style="margin: 0 0 8px 0; color: #475569; font-size: 0.9rem;">Special Notes:</h4>
        <p style="margin: 0; color: #334155; font-size: 0.875rem; white-space: pre-wrap; line-height: 1.5;">${checkIn.specialNotes}</p>
      </div>
      ` : ''}
      
      <div style="background: #fef2f2; border: 1px dashed #fca5a5; border-radius: 12px; padding: 12px 15px; margin-bottom: 15px;">
        <p style="margin: 0; font-size: 0.78rem; color: #ef4444; line-height: 1.5;">
          <strong>Hold Policy Note:</strong> Items will not automatically be held. Once a final selection is made, you or your fabricator may choose to hold under the fabricator's account for 7 days. After 7 days, tags may be removed without notice to you or your fabricator.
        </p>
      </div>
      
      <hr style="border: 0; border-top: 1px solid #eaeaea; margin: 20px 0;" />
      <p style="font-size: 0.8rem; color: #888; text-align: center; margin: 0;">This is an automated notification from the Easy Stones Check-In Portal.</p>
    </div>
  `;

  return await sendEmail({
    to: recipientEmail,
    subject: `🪨 Stone Selection Sheet: ${checkIn.name}`,
    html: emailHtml,
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
