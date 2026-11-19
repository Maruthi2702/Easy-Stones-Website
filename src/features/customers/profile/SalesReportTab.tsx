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

/**
 * Customer profile → Sales Report: this customer's sales by month from the SPS
 * report "Sales by Customer - Monthly" (Customers ⋯ → Import sales), tax not included.
 * Months with no sales stay blank. The year dropdown lists the years imported.
 */
export default function SalesReportTab({ customerId }: { customerId: string }) {
    const [year, setYear] = useState<number | null>(null);
    const [data, setData] = useState<Sales | null>(null);
    const [error, setError] = useState('');

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
        return <TabEmpty icon={<BarChart3 size={28} />} title="No sales imported yet" text="Import the SPS report “Sales by Customer - Monthly” from the Customers list (⋯ → Import sales)." />;
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
    const max = Math.max(1, ...data.cents.map(c => Math.max(c ?? 0, 0)));
    return (
        <div className="cl cp srt">
            {yearPicker(data, setYear)}
            <div className="srt-tiles">
                <div className="cl-sec"><span className="srt-k">{data.year} total</span><b>{money(s.total)}</b></div>
                <div className="cl-sec"><span className="srt-k">Monthly average</span><b>{money(s.average)}</b><span className="srt-s">{s.monthsWithSales} month{s.monthsWithSales === 1 ? '' : 's'} with sales</span></div>
                <div className="cl-sec"><span className="srt-k">Best month</span><b>{s.bestMonth >= 0 ? MONTH_NAMES[s.bestMonth] : '—'}</b>{s.bestMonth >= 0 && <span className="srt-s">{money(data.cents[s.bestMonth] as number)}</span>}</div>
            </div>
            <div className="cl-sec">
                <div className="srt-bars" role="img" aria-label={`Sales by month, ${data.year}`}>
                    {data.cents.map((c, i) => (
                        <div key={i} className="srt-col" title={c == null ? `${MONTH_NAMES[i]}: no sales` : `${MONTH_NAMES[i]}: ${money(c)}`}>
                            <div className="srt-bar" style={{ height: `${c && c > 0 ? Math.max(3, (c / max) * 100) : 0}%` }} />
                            <span>{MONTH_NAMES[i]}</span>
                        </div>
                    ))}
                </div>
            </div>
            <div className="cl-sec srt-tablewrap">
                <table className="srt-table">
                    <thead><tr><th>Month</th><th>Sales</th></tr></thead>
                    <tbody>
                        {data.cents.map((c, i) => (
                            <tr key={i}><td>{MONTH_NAMES[i]} {data.year}</td><td className={c == null ? 'srt-none' : c < 0 ? 'srt-neg' : ''}>{c == null ? '—' : money(c)}</td></tr>
                        ))}
                    </tbody>
                    <tfoot><tr><td>Total</td><td>{money(s.total)}</td></tr></tfoot>
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
