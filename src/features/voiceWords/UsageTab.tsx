import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { MonthPicker } from '../../components/shared/calendar/Calendar';
import { isoOf, shiftMonthKey } from '../../components/shared/calendar/calendarDates';
import type { UsageResponse } from '../../utils/assistantContract';
import { loadUsage } from './voiceWordsApi';
import { currentMonth, failRate, formatCost, formatCount, formatTokens, sortPeople } from './voiceWordsView';

/** Usage tab: what the assistant was used for in a month — counts and cost only; what people say is never stored. */
export default function UsageTab() {
  const [month, setMonth] = useState(currentMonth());
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const now = currentMonth();

  useEffect(() => {
    let live = true;
    setLoading(true); setError('');
    loadUsage(month)
      .then((u) => { if (live) setUsage(u); })
      .catch((e) => { if (live) { setUsage(null); setError((e as Error).message); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [month]);

  const people = usage ? sortPeople(usage.people) : [];
  const step = (n: number) => { const next = shiftMonthKey(month, n); if (next <= now) setMonth(next); };

  return (
    <section className="vw-usage" aria-label="Usage">
      <div className="vw-toolbar">
        <button type="button" className="vw-icon" onClick={() => step(-1)} aria-label="Previous month"><ChevronLeft size={18} /></button>
        <div className="vw-month"><MonthPicker id="vw-month" value={month} onChange={(m) => m && setMonth(m)} max={isoOf(new Date())} ariaLabel="Month" sheetTitle="Month" /></div>
        <button type="button" className="vw-icon" onClick={() => step(1)} disabled={month >= now} aria-label="Next month"><ChevronRight size={18} /></button>
      </div>

      {error ? <div className="vw-error" role="alert">{error}</div> : null}

      <div className="vw-tiles" aria-busy={loading}>
        <div className="vw-tile"><span className="vw-tile-k">Turns</span><b className="vw-tile-v">{usage ? formatCount(usage.turns) : '—'}</b><span className="vw-tile-s">things people said to it</span></div>
        <div className="vw-tile"><span className="vw-tile-k">Failed</span><b className="vw-tile-v">{usage ? formatCount(usage.failed) : '—'}</b><span className="vw-tile-s">{usage ? `${failRate(usage.failed, usage.turns)} of turns` : ' '}</span></div>
        <div className="vw-tile"><span className="vw-tile-k">Cost</span><b className="vw-tile-v">{usage ? formatCost(usage.costUsd) : '—'}</b><span className="vw-tile-s">estimated from list price</span></div>
        <div className="vw-tile"><span className="vw-tile-k">Tokens</span><b className="vw-tile-v">{usage ? formatTokens(usage.inputTokens + usage.outputTokens) : '—'}</b><span className="vw-tile-s">{usage ? `${formatTokens(usage.inputTokens)} in · ${formatTokens(usage.outputTokens)} out` : ' '}</span></div>
      </div>

      <h2 className="vw-h2">By person</h2>
      {usage && people.length === 0 ? (
        <div className="vw-empty"><p>No one used the voice assistant this month.</p></div>
      ) : people.length > 0 ? (
        <table className="vw-table">
          <thead><tr><th scope="col">Person</th><th scope="col" className="vw-num">Turns</th><th scope="col" className="vw-num">Failed</th></tr></thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.userId}><th scope="row">{p.name}</th><td className="vw-num">{formatCount(p.turns)}</td><td className="vw-num">{formatCount(p.failed)}{p.failed ? <span className="vw-rate"> · {failRate(p.failed, p.turns)}</span> : null}</td></tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <p className="vw-fine">Counts and cost only — what people say is never stored.</p>
    </section>
  );
}
