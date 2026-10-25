import { inclusiveDays, validDay } from './planning.ts';

export interface ReportPeriod { start: string; end: string }
/** A completed report supplies its own denominator; upload time is audit metadata. */
export function reportSalesPeriod(report: ReportPeriod | null | undefined, today: string, reportedThrough?: string) {
  if (!report || !validDay(report.start) || !validDay(report.end) || report.end < report.start)
    return { start: report?.start || '', through: '', days: 0, source: 'report' as const,
      errors: ['The uploaded sales report has a missing or invalid sales period'] };
  const completed = report.end <= today;
  const through = completed ? report.end : reportedThrough || '';
  if (!validDay(through) || through < report.start || through > report.end || through > today)
    return { start: report.start, through, days: 0, source: 'reported-through' as const,
      errors: ['This report includes future dates; use its actual sales-through date or a completed sales report'] };
  return { start: report.start, through, days: inclusiveDays(report.start, through),
    source: completed ? 'report' as const : 'reported-through' as const, errors: [] as string[] };
}
