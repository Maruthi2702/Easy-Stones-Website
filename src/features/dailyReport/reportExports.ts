import { FileText, Mail, FileSpreadsheet, Eye } from 'lucide-react';
import { API_URL } from '../../config/api';
import { monthOf } from '../../components/shared/calendar/calendarDates';
import { longDate } from './reportFigures';
import type { ExportItem } from './components/ExportMenu';

// Resend has no verified domain to send transactional mail from yet, so its
// default onboarding@resend.dev sender only delivers to the account's own
// signup address — every other recipient bounces. Sending falls through to
// the Gmail SMTP account instead (see emailService.js) until a domain is set
// up as RESEND_FROM_EMAIL.
const EMAIL_EXPORT_ENABLED = true;

type Scope = { view: string; date: string; location: string };

// The month PDF follows whichever branch the top bar is on; "all" is only
// offered to someone assigned to every branch, same as the CSV.
export const pdfUrlFor = ({ view, date, location }: Scope) => (view === 'month'
  ? `${API_URL}/api/daily-reports/export/${monthOf(date)}/pdf?location=${encodeURIComponent(location)}`
  : `${API_URL}/api/daily-reports/${date}/pdf?location=${encodeURIComponent(location)}&tzOffset=${-new Date().getTimezoneOffset()}`);

export const pdfNameFor = ({ view, date, location }: Scope) => (view === 'month'
  ? `daily_report_${monthOf(date)}_${(location === 'all' ? 'All_branches' : location).replace(/\s+/g, '_')}.pdf`
  : `daily_report_${date}_${String(location).replace(/\s+/g, '_')}.pdf`);

export const emailUrlFor = ({ view, date }: Scope) => (view === 'month'
  ? `${API_URL}/api/daily-reports/export/${monthOf(date)}/email`
  : `${API_URL}/api/daily-reports/${date}/email`);

export const csvUrlFor = (date: string, scope: 'all' | 'branch', location: string) => {
  const qs = scope === 'all' ? 'all' : encodeURIComponent(location);
  return `${API_URL}/api/daily-reports/export/${monthOf(date)}?location=${qs}`;
};

export const monthLabelOf = (date: string) => new Date(`${monthOf(date)}-01T00:00:00`)
  .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

/**
 * Everything you can do with the report on screen, in one menu.
 *
 * A single day's sheet is per branch, so PDF and email are offered on the
 * month whatever the scope, and on a day only once a branch is chosen —
 * "All locations" for one day has no one sheet to be.
 */
export const exportMenuItems = ({ view, date, location, allBranches, canExportAll, scopeLabel, monthLabel, onDownloadPdf, onEmail, onViewPdf, onCsv }: Scope & {
  allBranches: boolean;
  canExportAll: boolean;
  scopeLabel: string;
  monthLabel: string;
  onDownloadPdf: () => void;
  onEmail: () => void;
  onViewPdf: () => void;
  onCsv: (scope: 'all' | 'branch') => void;
}): ExportItem[] => [
  ...((view === 'month' || !allBranches) ? [
    {
      key: 'pdf',
      icon: FileText,
      label: 'Download PDF',
      hint: view === 'month' ? `${scopeLabel} · ${monthLabel}` : `${longDate(date)} · ${location}`,
      onSelect: onDownloadPdf
    },
    // Hidden until we have a domain to send from — see EMAIL_EXPORT_ENABLED.
    ...(EMAIL_EXPORT_ENABLED ? [{
      key: 'email',
      icon: Mail,
      label: 'Email as PDF…',
      hint: 'send it to one or more people',
      onSelect: onEmail
    }] : []),
    {
      key: 'pdf-view',
      icon: Eye,
      label: 'View as PDF',
      hint: 'preview it here, no download',
      onSelect: onViewPdf
    }
  ] : []),
  {
    key: 'csv',
    icon: FileSpreadsheet,
    label: `Download CSV — ${allBranches ? 'your branches' : 'this branch'}`,
    hint: `${scopeLabel} · ${monthLabel}`,
    onSelect: () => onCsv(allBranches ? 'all' : 'branch')
  },
  ...((canExportAll && !allBranches) ? [{
    key: 'csv-all',
    icon: FileSpreadsheet,
    label: 'Download CSV — every branch',
    hint: monthLabel,
    onSelect: () => onCsv('all')
  }] : [])
];
