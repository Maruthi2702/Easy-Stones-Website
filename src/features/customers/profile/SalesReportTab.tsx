import { useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { API_URL } from '../../../config/api';
import { authFetch } from '../../../api/authFetch';
import { MONTH_NAMES, salesSummary } from '../../../utils/customerSales';
import { TabEmpty, TabSkeleton } from './TabStates';
import './SalesReportTab.css';

type Sales = {
    year: number; years: number[]; matched: boolean; cents: (number | null)[];
    primaryRep: string; secondaryRep: string; importedAt: string | null; exportedOn: string;
};

const money = (cents: number) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const compact = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(cents / 100);

/**
 * Customer profile → Sales Report: this customer's sales by month from the SPS
 * report "Sales by Customer - Monthly" (Customers ⋯ → Import Sales Report), tax not included.
 * Months with no sales stay blank. The year dropdown lists the years imported.
 */
export default function SalesReportTab({ customerId }: { customerId: string }) {
    const [year, setYear] = useState<number | null>(null);
    const [data, setData] = useState<Sales | null>(null);
    const [error, setError] = useState('');
    const [picked, setPicked] = useState<number | null>(null);
    useEffect(() => { setPicked(null); }, [customerId, year]);

    useEffect(() => {
        let cancelled = false;
        setError('');
        (async () => {
            try {
                const res = await authFetch(`${API_URL}/api/customers/${customerId}/sales${year ? `?year=${year}` : ''}`);
                const body = await res.json();
                if (cancelled) return;
                if (!res.ok) { setError(body?.message || 'Could not load sales.'); return; }
                setData(body);
            } catch {
                if (!cancelled) setError('Could not load sales.');
            }
        })();
        return () => { cancelled = true; };
    }, [customerId, year]);

    if (error) return <div className="cl cp"><div className="cl-sec srt-note" role="alert">{error}</div></div>;
    if (!data) return <TabSkeleton />;

    if (!data.years.length) {
        return <TabEmpty icon={<BarChart3 size={28} />} title="No sales imported yet" text="Import the SPS report “Sales by Customer - Monthly” from the Customers list (⋯ → Import Sales Report)." />;
    }
    if (!data.matched) {
        return (
            <div className="cl cp">
                {yearPicker(data, setYear)}
                <TabEmpty icon={<BarChart3 size={28} />} title={`No sales in ${data.year}`} text="This customer’s name isn’t in the report for this year, or it had no sales." />
            </div>
        );
    }

    const s = salesSummary(data.cents);
    const now = new Date();
    const thisYear = now.getFullYear();
    const thisMonth = now.getMonth();
    const up = Math.max(0, ...data.cents.map(c => c ?? 0));
    const down = Math.max(0, ...data.cents.map(c => -(c ?? 0)));
    const range = Math.max(1, up + down);
    const shown = picked ?? (s.bestMonth >= 0 ? s.bestMonth : null);
    const shownCents = shown != null ? data.cents[shown] : null;
    const positiveTotal = data.cents.reduce<number>((t, c) => t + Math.max(c ?? 0, 0), 0);
    return (
        <div className="cl cp srt">
            <div className="srt-tiles">
                <div className="cl-sec"><span className="srt-k">{data.year} total</span><b>{money(s.total)}</b><span className="srt-s">Before tax</span></div>
                <div className="cl-sec"><span className="srt-k">Monthly average</span><b>{money(s.average)}</b><span className="srt-s">{s.monthsWithSales} month{s.monthsWithSales === 1 ? '' : 's'} with sales</span></div>
                <div className="cl-sec"><span className="srt-k">Best month</span><b>{s.bestMonth >= 0 ? MONTH_NAMES[s.bestMonth] : '—'}</b>{s.bestMonth >= 0 && <span className="srt-s">{money(data.cents[s.bestMonth] as number)}</span>}</div>
            </div>
            <div className="cl-sec srt-card">
                <div className="srt-head">
                    <div>
                        <h3>Sales by month</h3>
                        <p className="srt-read" aria-live="polite">
                            {shown != null && shownCents != null ? <><b>{MONTH_NAMES[shown]} {data.year}</b> · {money(shownCents)}</> : 'Tap a bar to see its month'}
                        </p>
                    </div>
                    {yearPicker(data, setYear)}
                </div>
                <div className="srt-chart" role="group" aria-label={`Sales by month, ${data.year}`}>
                    <div className="srt-plot">
                        <div className="srt-zero" style={{ top: `${(up / range) * 100}%` }} aria-hidden="true" />
                        {data.cents.map((c, i) => {
                            const has = c != null && c !== 0;
                            const h = has ? Math.max(1.5, (Math.abs(c as number) / range) * 100) : 0;
                            const neg = has && (c as number) < 0;
                            return (
                                <button key={i} type="button" className={`srt-col${shown === i ? ' srt-on' : ''}${has ? '' : ' srt-empty'}`}
                                    onClick={() => setPicked(picked === i ? null : i)}
                                    aria-pressed={shown === i}
                                    aria-label={`${MONTH_NAMES[i]} ${data.year}: ${c == null ? 'no sales' : money(c)}`}>
                                    {has && (
                                        <span className={`srt-bar${neg ? ' srt-neg-bar' : i === s.bestMonth ? ' srt-best' : ''}`}
                                            style={neg ? { top: `${(up / range) * 100}%`, height: `${h}%` } : { bottom: `${(down / range) * 100}%`, height: `${h}%` }}>
                                            <span className={`srt-val${neg ? ' srt-val-neg' : ''}`}>{compact(c as number)}</span>
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                    <div className="srt-axis" aria-hidden="true">
                        {MONTH_NAMES.map((m, i) => (
                            <span key={i} className={data.year === thisYear && i === thisMonth ? 'srt-now' : ''}>
                                <span className="srt-m-full">{m.slice(0, 3)}</span><span className="srt-m-short">{m[0]}</span>
                            </span>
                        ))}
                    </div>
                </div>
                <table className="srt-table">
                    <thead><tr><th>Month</th><th className="srt-sharecol">Share of year</th><th>Sales</th></tr></thead>
                    <tbody>
                        {data.cents.map((c, i) => (
                            <tr key={i} className={shown === i ? 'srt-row-on' : ''} onClick={() => setPicked(i)}>
                                <td>
                                    {MONTH_NAMES[i]} {data.year}
                                    {data.year === thisYear && i === thisMonth && <span className="srt-chip">This month</span>}
                                </td>
                                <td className="srt-sharecol">{c != null && c > 0 && positiveTotal > 0 ? `${Math.round((c / positiveTotal) * 100)}%` : ''}</td>
                                <td className={c == null ? 'srt-none' : c < 0 ? 'srt-neg' : 'srt-has'}>{c == null ? '—' : money(c)}</td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot><tr><td>{data.year} total</td><td className="srt-sharecol" /><td>{money(s.total)}</td></tr></tfoot>
                </table>
            </div>
            <p className="srt-note">
                Sales by Customer - Monthly, tax not included, all locations
                {data.primaryRep && <> · Sales person: {data.primaryRep}{data.secondaryRep ? `, ${data.secondaryRep}` : ''}</>}
                {data.exportedOn && <> · Report exported {data.exportedOn}</>}
            </p>
        </div>
    );
}

function yearPicker(data: Sales, setYear: (y: number) => void) {
    if (data.years.length < 2) return null;
    return (
        <div className="srt-year">
            <label>Year{' '}
                <select value={data.year} onChange={e => setYear(Number(e.target.value))}>
                    {data.years.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
            </label>
        </div>
    );
}
