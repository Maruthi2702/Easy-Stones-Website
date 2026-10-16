import { buildDayPdf, dayPdfFileName } from './dailyReportPdf.js';
import { sendEmail } from '../services/emailService.js';
import Location from '../models/Location.js';
import User from '../models/User.js';
import { recipientEmails, seedFromAddresses, SEATTLE_RECIPIENTS_BEFORE_2026_10_15 } from './dailyReportRecipients.js';

/**
 * A location's daily report goes out to its list (Users & Roles → Locations
 * → Edit → "Daily Report email", src/utils/dailyReportRecipients.js) the
 * moment the day is submitted — whether a person clicked Submit or the
 * 11:59 PM auto-submit job closed it out — so nobody on it has to remember to
 * use Export → Email as PDF every evening. A location with nobody listed gets
 * no email. (Until 2026-10-15 this was Seattle only, to a list in the code.)
 */
async function recipientsFor(locationName) {
  const location = await Location.findOne({ name: locationName }, 'dailyReportEmail').lean();
  const setting = location?.dailyReportEmail;
  const ids = setting?.userIds || [];
  const users = ids.length ? await User.find({ _id: { $in: ids } }, 'email isActive').lean() : [];
  return recipientEmails(setting, users);
}

/**
 * Once, at server start: Seattle's list was typed into the code until
 * 2026-10-15; copy it onto Seattle's location so the email keeps arriving,
 * now editable in Users & Roles → Locations. Runs only while that location
 * has no list field at all (read raw, past the schema's default), so a list
 * someone later empties stays empty. Returns what it saved, or null.
 */
export async function seedSeattleRecipients() {
  const seattle = await Location.collection.findOne({ name: 'Seattle', dailyReportEmail: { $exists: false } });
  if (!seattle) return null;
  const users = await User.find({ email: { $in: SEATTLE_RECIPIENTS_BEFORE_2026_10_15 } }, 'email isActive').lean();
  const dailyReportEmail = seedFromAddresses(SEATTLE_RECIPIENTS_BEFORE_2026_10_15, users);
  const result = await Location.collection.updateOne(
    { _id: seattle._id, dailyReportEmail: { $exists: false } },
    { $set: { dailyReportEmail } }
  );
  return result.modifiedCount ? dailyReportEmail : null;
}

/**
 * Fire-and-forget: called from both the submit route and the auto-submit
 * job, neither of which should fail — or make the person submitting wait —
 * because a notification email had trouble sending.
 */
export async function notifyDailyReportSubmission(report) {
  try {
    const to = await recipientsFor(report.location);
    if (!to.length) return;

    const bytes = await buildDayPdf(report);
    const html = `
      <div style="font-family:Helvetica,Arial,sans-serif;color:#1b1a17;line-height:1.55">
        <h2 style="margin:0 0 4px;font-size:17px">Daily Work Report — ${escapeHtml(report.location)}</h2>
        <p style="margin:0 0 14px;color:#6b6b6b;font-size:13px">
          ${report.date} &middot; ${report.autoSubmitted ? 'Submitted automatically' : `Submitted${report.submittedBy ? ` by ${escapeHtml(report.submittedBy)}` : ''}`}
        </p>
        <p style="margin:0;font-size:13px">The report is attached as a PDF.</p>
      </div>`;

    const result = await sendEmail({
      to,
      subject: `Daily Work Report — ${report.location}, ${report.date}`,
      html,
      defaultSenderName: 'Easy Stones',
      attachments: [{ filename: dayPdfFileName(report), content: Buffer.from(bytes) }]
    });

    if (result.success) {
      console.log(`✅ ${report.location} daily report emailed for ${report.date} to ${to.length}`);
    } else {
      console.error(`⚠️ ${report.location} daily report email failed for ${report.date}: ${result.error}`);
    }
  } catch (error) {
    console.error(`⚠️ ${report.location} daily report email threw for ${report.date}:`, error);
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
