import { useId, useMemo, useState } from 'react';
import { groupRepOptions } from '../../../utils/salesReps';
import { isJustMe } from '../dashboardPeople';
import type { PersonOption } from '../../../api/myTeam';
import './PeopleField.css';

/**
 * The People field in the Sales dashboard's Filters panel (dashboardPeople.ts):
 * "Me" and "My team" first, then the reps grouped under their branch with the
 * viewer marked "(you)" — the shared rep format (groupRepOptions) — as
 * checkboxes, with a search box once there are more than 8. Same checkbox rows
 * as the panel's Locations list.
 */
export type PeopleFieldProps = {
    options: PersonOption[];
    value: string[];
    me: string;
    onChange: (people: string[]) => void;
    onToggle: (id: string) => void;
};

/** Everything a panel needs to show the People field (built once by DashboardPage). */
export type PeopleFilter = PeopleFieldProps & {
    /** Not the default (Me): lights the Filters button's dot. */
    active: boolean;
    /** Clear Filter: back to Me. */
    onReset: () => void;
    /** Who is in view, in words ("Me", "My team", a name…). */
    summary: string;
};

const SEARCH_FROM = 8;

export default function PeopleField({ options, value, me, onChange, onToggle }: PeopleFieldProps) {
    const id = useId();
    const [query, setQuery] = useState('');
    const groups = useMemo(() => groupRepOptions(options, { you: me, query }), [options, me, query]);
    const team = value.length === 0;
    const justMe = isJustMe(value, me);

    return (
        <div className="lf-group" role="group" aria-labelledby={`${id}-label`}>
            <span className="lf-group-label" id={`${id}-label`}>People</span>
            <div className="lf-checks dp-checks">
                <label className="lf-check">
                    <input type="checkbox" checked={justMe} onChange={() => onChange([me])} />
                    <span>Me</span>
                </label>
                <label className="lf-check">
                    <input type="checkbox" checked={team} onChange={() => onChange([])} />
                    <span>My team</span>
                </label>
                {options.length > SEARCH_FROM && (
                    <input
                        type="search" className="dp-search" placeholder="Search people…" aria-label="Search people"
                        value={query} onChange={(e) => setQuery(e.target.value)}
                    />
                )}
                {groups.map((g) => (
                    <div key={g.group} className="dp-branch" role="group" aria-label={g.group}>
                        <span className="dp-branch-name">{g.group}</span>
                        {g.options.map((o: PersonOption & { you?: boolean }) => (
                            <label key={o.value} className="lf-check">
                                <input type="checkbox" checked={!team && value.includes(o.value)} onChange={() => onToggle(o.value)} />
                                <span>{o.label}{o.inactive && <em className="dp-inactive"> · inactive</em>}</span>
                            </label>
                        ))}
                    </div>
                ))}
                {query.trim() && groups.length === 0 && <span className="dp-none">No one matches “{query.trim()}”.</span>}
            </div>
        </div>
    );
}
