import { sendEmail } from './emailService.ts';
import { recipientsFor } from '../utils/dailyReportSubmissionEmail.ts';
import { arrivalEmailLines } from '../utils/transferArrival.ts';

type ArrivalEmailTicket = Parameters<typeof arrivalEmailLines>[0];

const escapeHtml = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c as '&' | '<' | '>' | '"' | "'"]));

/**
 * Tells the sending branch that another branch logged one of its transfers
 * on arrival: to the people on its Daily Report email list (Users & Roles →
 * Locations → Daily Report email), since the transfer lands on that report.
 * A branch with nobody listed gets no email. Fire-and-forget: the arrival is
 * already saved, and a mail failure is only logged.
 */
export async function notifyArrivalLogged(
  ticket: ArrivalEmailTicket,
  details: Parameters<typeof arrivalEmailLines>[1]
) {
  try {
    const to = await recipientsFor(ticket.location);
    if (!to.length) return;
    const [headline, ...rest] = arrivalEmailLines(ticket, details);
    const html = `
      <div style="font-family:Helvetica,Arial,sans-serif;color:#1b1a17;line-height:1.55">
        <h2 style="margin:0 0 8px;font-size:17px">${escapeHtml(headline)}</h2>
        ${rest.map((line) => `<p style="margin:0 0 8px;font-size:14px">${escapeHtml(line)}</p>`).join('')}
      </div>`;
    const result = await sendEmail({
      to,
      subject: `Transfer from ${ticket.location} logged on arrival at ${ticket.transferDestination} — ${ticket.date}`,
      html,
      defaultSenderName: 'Easy Stones'
    });
    if (!result.success) console.error(`⚠️ arrival email to ${ticket.location} failed: ${result.error}`);
  } catch (error) {
    console.error(`⚠️ arrival email to ${ticket.location} threw:`, error);
  }
}
