import { useEffect, useState } from 'react';
import { DatePicker, MonthPicker } from '../../../components/shared/calendar/Calendar';
import { shiftDay } from '../../../components/shared/calendar/calendarDates';
import { SegmentedToggle } from '../../../components/shared/form/FormControls';
import { MAX_RANGE_DAYS, monthOf, shiftMonth } from '../../../utils/cardReceipts';

export type Range = { from: string; to: string };

/**
 * The Expenses period, inside the Filters panel (2026-11-25, owner: "move this to filter icon, match it with the
 * dashboard custom filter"): Month | Custom, the way the dashboard's Time range has Custom. Month is the shared
 * month calendar (the picked month marked, nothing after this month); Custom is From / To (the shared day calendar,
 * at most a year, both ends included) and changes nothing until Apply — the dashboard's CustomDays.
 */
export default function PeriodField({ month, range, today, onMonth, onRange }: {
  month: string; range: Range | null; today: string;
  onMonth: (m: string) => void; onRange: (r: Range | null) => void;
}) {
  // Custom picked here but not applied yet; a range set anywhere else wins.
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
    <div className="lf-group ccr-period" role="group" aria-labelledby="ccr-f-period">
      <span className="lf-group-label" id="ccr-f-period">Period</span>
      <SegmentedToggle<string>
        label="Period"
        value={custom ? 'custom' : 'month'}
        onChange={(v) => {
          if (v === 'custom') setPending(true);
          else { setPending(false); if (range) onMonth(monthOf(range.to)); }
        }}
        options={[{ value: 'month', label: 'Month' }, { value: 'custom', label: 'Custom' }]}
      />
      {custom ? (
        <div className="ccr-period-custom">
          <div className="ccr-period-days">
            <DatePicker id="ccr-range-from" ariaLabel="From" placeholder="From" value={a} max={today || b || undefined} today={today} onChange={setFrom} sheetTitle="From" />
            <DatePicker id="ccr-range-to" ariaLabel="To" placeholder="To" value={b} min={a || undefined} max={today || undefined} today={today} onChange={setTo} sheetTitle="To" />
          </div>
          <button type="button" className="ccr-period-apply" disabled={!a || !b} onClick={() => onRange({ from: a, to: b })}>Apply</button>
        </div>
      ) : (
        <MonthPicker id="ccr-f-month" ariaLabel="Month" value={month} max={today || undefined} today={today} onChange={onMonth} sheetTitle="Month" />
      )}
    </div>
  );
}
