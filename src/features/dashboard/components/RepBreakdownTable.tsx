import { Loader } from 'lucide-react';
import { repTotals } from '../repBreakdown';
import type { RepRow } from '../repBreakdown';
import './RepBreakdown.css';

/**
 * Sales Visits → "By rep" (repBreakdown.ts): one row per person in view with
 * their visits, resources, follow-ups and how many of those are late, for the
 * period and filters on screen, and a total row that matches the tiles. A
 * row opens that person's work in the list (`onPick`).
 */
export type RepBreakdownTableProps = {
    rows: RepRow[];
    loading?: boolean;
    /** The "Today" column (stops on their calendar today) — only with the team calendar. */
    showToday?: boolean;
    onPick: (id: string) => void;
};

export default function RepBreakdownTable({ rows, loading = false, showToday = false, onPick }: RepBreakdownTableProps) {
    if (rows.length === 0) {
        return (
            <div className="dfx-empty">
                {loading ? <span><Loader size={16} className="animate-spin" /> Loading…</span> : <span>No one to show for these filters.</span>}
            </div>
        );
    }
    const total = repTotals(rows);
    return (
        <div className="drb-wrap">
            <table className="drb-table">
                <thead>
                    <tr>
                        <th scope="col">Rep</th>
                        <th scope="col" className="drb-num">Visits</th>
                        <th scope="col" className="drb-num"><span className="drb-long">Resources</span><span className="drb-short" aria-hidden="true">Res.</span></th>
                        <th scope="col" className="drb-num"><span className="drb-long">Follow-ups</span><span className="drb-short" aria-hidden="true">F-ups</span></th>
                        <th scope="col" className="drb-num">Late</th>
                        {showToday && <th scope="col" className="drb-num" title="Stops on their calendar today">Today</th>}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r) => {
                        const pickable = Boolean(r.id);
                        return (
                            <tr key={r.id || 'none'} className={pickable ? 'is-pickable' : ''} onClick={pickable ? () => onPick(r.id) : undefined}>
                                <th scope="row">
                                    {pickable ? (
                                        <button type="button" className="drb-name" title={`Show ${r.name}'s work`} onClick={(e) => { e.stopPropagation(); onPick(r.id); }}>
                                            {r.name}{r.you ? ' (you)' : ''}
                                        </button>
                                    ) : <span className="drb-name drb-name--plain">{r.name}</span>}
                                    {(r.branch || r.inactive) && (
                                        <span className="drb-sub">{[r.branch, r.inactive ? 'inactive' : ''].filter(Boolean).join(' · ')}</span>
                                    )}
                                </th>
                                <td className={`drb-num${r.visits ? '' : ' is-zero'}`}>{r.visits}</td>
                                <td className={`drb-num${r.resources ? '' : ' is-zero'}`}>{r.resources}</td>
                                <td className={`drb-num${r.followUps ? '' : ' is-zero'}`}>{r.followUps}</td>
                                <td className={`drb-num${r.late ? ' is-late' : ' is-zero'}`}>{r.late}</td>
                                {showToday && <td className={`drb-num${r.todayStops ? '' : ' is-zero'}`}>{r.todayStops}</td>}
                            </tr>
                        );
                    })}
                </tbody>
                <tfoot>
                    <tr>
                        <th scope="row">Total</th>
                        <td className="drb-num">{total.visits}</td>
                        <td className="drb-num">{total.resources}</td>
                        <td className="drb-num">{total.followUps}</td>
                        <td className={`drb-num${total.late ? ' is-late' : ''}`}>{total.late}</td>
                        {showToday && <td className="drb-num">{total.todayStops}</td>}
                    </tr>
                </tfoot>
            </table>
        </div>
    );
}

/** The Sales Visits card's "List | By rep" switch. */
export function VisitsViewSwitch({ value, onChange }: { value: 'list' | 'byRep'; onChange: (v: 'list' | 'byRep') => void }) {
    return (
        <div className="drb-switch" role="group" aria-label="Show visits as">
            <button type="button" className={value === 'list' ? 'is-on' : ''} aria-pressed={value === 'list'} onClick={() => onChange('list')}>List</button>
            <button type="button" className={value === 'byRep' ? 'is-on' : ''} aria-pressed={value === 'byRep'} onClick={() => onChange('byRep')}>By rep</button>
        </div>
    );
}
