import type { MonthState } from '../../../utils/salesGoals';

/**
 * The goal bar (design: claude.ai artifact "Sales Dash — Rep Sales & Goals").
 *   mode "pace"  — the table's bar: fills to 100% of the goal, with a mark where the rep would be
 *                  on pace today (the share of the month or year gone).
 *   mode "goal"  — the month table's bar: the track runs to 120% of the goal, a line marks the goal,
 *                  and a month that beats it runs on past the line in a lighter shade.
 * Blue is on or past the goal / pace, orange is under it; the state is also said in words beside it.
 */
type Props = {
    pct: number | null;
    state: MonthState | 'met' | 'onpace' | 'behind' | 'none';
    /** 0–1, "pace" mode only. */
    pace?: number | null;
    mode?: 'pace' | 'goal';
    label?: string;
};

const GOAL_AT = (100 / 120) * 100;
const good = (state: Props['state']) => state === 'met' || state === 'onpace';

export default function GoalBar({ pct, state, pace = null, mode = 'pace', label }: Props) {
    const has = pct != null && state !== 'none' && state !== 'upcoming';
    const tone = good(state) ? 'gl-up' : 'gl-dn';
    if (mode === 'goal') {
        const p = has ? pct as number : 0;
        const w1 = (Math.min(p, 100) / 120) * 100;
        const w2 = (Math.max(0, Math.min(p, 120) - 100) / 120) * 100;
        return (
            <svg className="gl-bar gl-bar--goal" width="100%" height="10" role="img" aria-label={label ?? (has ? `${p}% of the goal` : 'No bar')}>
                <rect className="gl-track" width="100%" height="10" rx="5" />
                {has && <rect className={tone} width={`${w1}%`} height="10" rx="5" />}
                {has && w2 > 0 && <rect className={`${tone} gl-over`} x={`${GOAL_AT}%`} width={`${w2}%`} height="10" />}
                {state !== 'none' && <rect className="gl-line" x={`${GOAL_AT}%`} y="-2" width="2" height="14" rx="1" />}
            </svg>
        );
    }
    const p = has ? Math.min(pct as number, 100) : 0;
    return (
        <svg className="gl-bar" width="100%" height="8" role="img" aria-label={label ?? (has ? `${pct}% of the goal` : 'No goal set')}>
            <rect className="gl-track" width="100%" height="8" rx="4" />
            {has && <rect className={tone} width={`${p}%`} height="8" rx="4" />}
            {has && pace != null && <rect className="gl-line" x={`${Math.min(Math.max(pace, 0), 1) * 100}%`} y="-3" width="2" height="14" rx="1" />}
        </svg>
    );
}
