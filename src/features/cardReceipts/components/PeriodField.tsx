import { useEffect, useState } from 'react';
import { DatePicker, MonthPicker } from '../../../components/shared/calendar/Calendar';
import { shiftDay } from '../../../components/shared/calendar/calendarDates';
import { MAX_RANGE_DAYS, monthOf, shiftMonth } from '../../../utils/cardReceipts';

export type Range = { from: string; to: string };

/**
 * The Expenses period, one field in the Filters panel (2026-11-25, owner: "show custom button inside the dropdown so
 * that we don't consume a lot of space"). The field is the shared month calendar (the picked month checked, nothing
 * after this month) and its footer has a **Custom range** button; that swaps the field for From / To (the shared day
 * calendar, at most a year, both ends included), which change nothing until Apply, like the dashboard's custom
 * filter. The month field is not shown beside them; "Pick a month" in the label row goes back.
 */
export default function PeriodField({ month, range, today, onMonth, onRange }: {
  month: string; range: Range | null; today: string;
  onMonth: (m: string) => void; onRange: (r: Range | null) => void;
}) {
  // Custom chosen in the calendar but not applied yet; a range set anywhere else wins.
  const [pending, setPending] = useState(false);
  const custom = pending || Boolean(range);
  // Opens on the month that was showing, never past today.
  const startFrom = range?.from ?? `${month}-01`;
  const startTo = range?.to ?? ((): string => { const last = shiftDay(`${shiftMonth(month, 1)}-01`, -1); return today && last > today ? today : last; })();
  const [a, setA] = useState(startFrom);
  const [b, setB] = useState(startTo);
  useEffect(() => { setA(startFrom); setB(startTo); }, [startFrom, startTo]);
  useEffect(() => { if (range) setPending(false); }, [range]);

  const span = MAX_RANGE_DAYS - 1;
  const setFrom = (from: string) => { setA(from); if (from && b && b < from) setB(from); else if (from && b && b > shiftDay(from, span)) setB(shiftDay(from, span)); };
  const setTo = (to: string) => { setB(to); if (to && a && a > to) setA(to); else if (to && a && a < shiftDay(to, -span)) setA(shiftDay(to, -span)); };

  return (
    <div className="lf-group ccr-period">
      <div className="ccr-period-head">
        <label className="lf-group-label" htmlFor={custom ? 'ccr-range-from' : 'ccr-f-month'}>{custom ? 'Period · Custom range' : 'Period'}</label>
        {/* While a custom range is open the month field is gone; this goes back to a month. */}
        {custom ? (
          <button type="button" className="ccr-period-back" onClick={() => { setPending(false); if (range) onMonth(monthOf(range.to)); }}>Pick a month</button>
        ) : null}
      </div>
      {custom ? (
        <div className="ccr-period-custom">
          <div className="ccr-period-days">
            <DatePicker id="ccr-range-from" ariaLabel="From" placeholder="From" value={a} max={today || b || undefined} today={today} onChange={setFrom} sheetTitle="From" />
            <DatePicker id="ccr-range-to" ariaLabel="To" placeholder="To" value={b} min={a || undefined} max={today || undefined} today={today} onChange={setTo} sheetTitle="To" />
          </div>
          <button type="button" className="ccr-period-apply" disabled={!a || !b} onClick={() => onRange({ from: a, to: b })}>Apply</button>
        </div>
      ) : (
        <MonthPicker
          id="ccr-f-month" ariaLabel="Period" value={month} max={today || undefined} today={today}
          onChange={(m) => { setPending(false); onMonth(m); }} sheetTitle="Period"
          extra={{ label: 'Custom range…', onClick: () => setPending(true) }}
        />
      )}
    </div>
  );
}
