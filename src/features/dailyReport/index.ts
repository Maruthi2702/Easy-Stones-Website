// The Daily Work Report (MIGRATION_NOTES.md §4, step B). The Sales shell
// lazy-loads the page file itself — `import('../dailyReport/DailyReportTab')`
// in SalesTabViews — so the page stays its own chunk and its CSS keeps its
// place; everything else outside the module imports from here.
export type { DailyReportTabProps } from './DailyReportTab';
export { buildSaveBody, buildDraftPayload } from './savePayload';
export { useDaySheet } from './useDaySheet';
export type { DaySheet, DaySheetOptions } from './useDaySheet';
export type { Report, TransferLine, ContainerLine, SummaryRow, Figure } from './types';
