import { buildDayPdf, dayPdfFileName } from './dailyReportPdf.js';
import { sendEmail } from '../services/emailService.js';

/**
 * Seattle's daily report goes out to this list the moment the day is
 * submitted — whether a person clicked Submit or the 11:59 PM auto-submit
 * job closed it out — so nobody on it has to remember to use Export → Email
 * as PDF every evening. Other branches don't get this; only Seattle asked.
 */
const SEATTLE_RECIPIENTS = [
  'sree@easystones.com',
  'jeremy@easystones.com',
  'vish@easystones.com',
  'krish@easystones.com'
];

/**
 * Fire-and-forget: called from both the submit route and the auto-submit
 * job, neither of which should fail — or make the person submitting wait —
 * because a notification email had trouble sending.
 */
export async function notifyDailyReportSubmission(report) {
  if (report.location !== 'Seattle') return;

  try {
    const bytes = await buildDayPdf(report);
    const html = `
      <div style="font-family:Helvetica,Arial,sans-serif;color:#1b1a17;line-height:1.55">
        <h2 style="margin:0 0 4px;font-size:17px">Daily Work Report — Seattle</h2>
        <p style="margin:0 0 14px;color:#6b6b6b;font-size:13px">
          ${report.date} &middot; ${report.autoSubmitted ? 'Submitted automatically' : `Submitted${report.submittedBy ? ` by ${report.submittedBy}` : ''}`}
        </p>
        <p style="margin:0;font-size:13px">The report is attached as a PDF.</p>
      </div>`;

    const result = await sendEmail({
      to: SEATTLE_RECIPIENTS,
      subject: `Daily Work Report — Seattle, ${report.date}`,
      html,
      defaultSenderName: 'Easy Stones',
      attachments: [{ filename: dayPdfFileName(report), content: Buffer.from(bytes) }]
    });

    if (result.success) {
      console.log(`✅ Seattle daily report emailed for ${report.date}`);
    } else {
      console.error(`⚠️ Seattle daily report email failed for ${report.date}: ${result.error}`);
    }
  } catch (error) {
    console.error(`⚠️ Seattle daily report email threw for ${report.date}:`, error);
  }
}
