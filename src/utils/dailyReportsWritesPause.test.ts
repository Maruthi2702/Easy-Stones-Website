import { describe, it, expect } from 'vitest';
import { isDailyReportWrite, dailyReportsWritesPaused } from './dailyReportsWritesPause.ts';

describe('daily reports pause', () => {
  it('is on only for the word true', () => {
    expect(dailyReportsWritesPaused({ DAILY_REPORTS_WRITES_PAUSED: 'true' } as never)).toBe(true);
    expect(dailyReportsWritesPaused({ DAILY_REPORTS_WRITES_PAUSED: ' TRUE ' } as never)).toBe(true);
    expect(dailyReportsWritesPaused({} as never)).toBe(false);
    expect(dailyReportsWritesPaused({ DAILY_REPORTS_WRITES_PAUSED: '1' } as never)).toBe(false);
  });
  it('stops report writes (submit, reopen, autosave, email) and arrivals, never reads or other areas', () => {
    expect(isDailyReportWrite('PUT', '/api/daily-reports/2026-11-13?location=Seattle')).toBe(true);
    expect(isDailyReportWrite('POST', '/api/daily-reports/2026-11-13/submit')).toBe(true);
    expect(isDailyReportWrite('POST', '/api/daily-reports/2026-11-13/reopen')).toBe(true);
    expect(isDailyReportWrite('POST', '/api/deliveries/arrivals')).toBe(true);
    expect(isDailyReportWrite('GET', '/api/daily-reports/2026-11-13')).toBe(false);
    expect(isDailyReportWrite('GET', '/api/daily-reports/2026-11-13/log')).toBe(false);
    expect(isDailyReportWrite('PATCH', '/api/deliveries/abc/status')).toBe(false);
    // Payments and Check In move in the same window
    expect(isDailyReportWrite('POST', '/api/payments-received')).toBe(true);
    expect(isDailyReportWrite('PUT', '/api/checkin/abc')).toBe(true);
    expect(isDailyReportWrite('GET', '/api/checkin')).toBe(false);
    expect(isDailyReportWrite('POST', '/api/customers')).toBe(false);
  });
});
