import { useEffect, useState } from 'react';
import { BarChart3, ChevronLeft, ChevronRight } from 'lucide-react';
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

/**
 * Customer profile → Sales Report: this customer's sales by month from the SPS
 * report "Sales by Customer - Monthly" (Customers ⋯ → Import Sales Report), tax not included.
 * Months with no sales show a dash; each month has a bar against the biggest month (red for a negative one).
 * The year stepper moves between the years imported.
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
    const biggest = Math.max(1, ...data.cents.map(c => Math.abs(c ?? 0)));
    const shown = picked ?? (s.bestMonth >= 0 ? s.bestMonth : null);
    return (
        <div className="cl cp srt">
            <div className="srt-tiles">
                <div className="cl-sec"><span className="srt-k">{data.year} total</span><b>{money(s.total)}</b><span className="srt-s">Before tax</span></div>
                <div className="cl-sec"><span className="srt-k">Monthly average</span><b>{money(s.average)}</b><span className="srt-s">{s.monthsWithSales} month{s.monthsWithSales === 1 ? '' : 's'} with sales</span></div>
                <div className="cl-sec"><span className="srt-k">Best month</span><b>{s.bestMonth >= 0 ? MONTH_NAMES[s.bestMonth] : '—'}</b>{s.bestMonth >= 0 && <span className="srt-s">{money(data.cents[s.bestMonth] as number)}</span>}</div>
            </div>
            <div className="cl-sec srt-card">
                <div className="srt-head">
                    <h3>Sales by month</h3>
                    {yearPicker(data, setYear)}
                </div>
                <table className="srt-table">
                    <thead><tr><th>Month</th><th className="srt-barcol">Vs best month</th><th>Sales</th></tr></thead>
                    <tbody>
                        {data.cents.map((c, i) => (
                            <tr key={i} className={shown === i ? 'srt-row-on' : ''} onClick={() => setPicked(i)}>
                                <td>
                                    {MONTH_NAMES[i]} {data.year}
                                    {data.year === thisYear && i === thisMonth && <span className="srt-chip">This month</span>}
                                </td>
                                <td className="srt-barcol" aria-hidden="true">
                                    {c != null && c !== 0 && (
                                        <span className="srt-track"><span className={`srt-fill${c < 0 ? ' srt-fill-neg' : ''}`} style={{ width: `${Math.max(2, Math.round((Math.abs(c) / biggest) * 100))}%` }} /></span>
                                    )}
                                </td>
                                <td className={c == null ? 'srt-none' : c < 0 ? 'srt-neg' : 'srt-has'}>{c == null ? '—' : money(c)}</td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot><tr><td>{data.year} total</td><td className="srt-barcol" /><td>{money(s.total)}</td></tr></tfoot>
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
    const years = [...data.years].sort((x, y) => x - y);
    const at = years.indexOf(data.year);
    return (
        <div className="srt-year" role="group" aria-label="Year">
            <button type="button" aria-label="Previous year" disabled={at <= 0} onClick={() => setYear(years[at - 1])}><ChevronLeft size={16} /></button>
            <span>{data.year}</span>
            <button type="button" aria-label="Next year" disabled={at < 0 || at >= years.length - 1} onClick={() => setYear(years[at + 1])}><ChevronRight size={16} /></button>
        </div>
    );
}
