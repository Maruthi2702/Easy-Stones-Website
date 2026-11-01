import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import useIsPhone from '../../../components/shared/form/useIsPhone';
import { FormSheet } from '../../../components/shared/form/FormControls';
import { clipParentOf, useMenuPlacement } from '../../../components/shared/form/formFocus';
import { groupRepOptions } from '../../../utils/salesReps';
import { isJustMe, peopleSummary } from '../dashboardPeople';
import type { PersonOption } from '../../../api/myTeam';
import '../../../components/shared/form/FormModal.css';
import './PeopleField.css';

/**
 * The People field in the Sales dashboard's Filters panel (dashboardPeople.ts):
 * a dropdown in the Customer List's Sales rep filter format (owner's call,
 * 2026-11-01) — the field says who is in view ("Me", "My team", a name,
 * "3 people"); its list has a search box, "Me" and "My team", then the reps
 * as checkboxes under a heading for their branch with the viewer marked
 * "(you)" (groupRepOptions). The list stays open while you tick. Same trigger
 * and placement as the panel's Location field (LocationPicker): floating under
 * the field, inside the panel (never portaled), a bottom sheet on phones.
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

export default function PeopleField({ options, value, me, onChange, onToggle }: PeopleFieldProps) {
    const id = useId();
    const isPhone = useIsPhone();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const wrapRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const pos = useMenuPlacement(open, isPhone, triggerRef, menuRef, clipParentOf);
    const sheet = isPhone || pos.placement === 'sheet';

    const groups = useMemo(() => groupRepOptions(options, { you: me, query }), [options, me, query]);
    const team = value.length === 0;
    const justMe = isJustMe(value, me);
    const typed = query.trim();
    const summary = peopleSummary(value, me, (pid) => options.find((o) => o.value === pid)?.label);

    const close = (refocus = true) => {
        setOpen(false);
        setQuery('');
        if (refocus) triggerRef.current?.focus({ preventScroll: true });
    };

    useEffect(() => {
        if (!open || sheet) return undefined;
        searchRef.current?.focus({ preventScroll: true });
        const onDown = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) close(false); };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [open, sheet]);

    const row = (key: string, on: boolean, label: ReactNode, onClick: () => void) => (
        <button key={key} type="button" role="checkbox" aria-checked={on} className="fm-opt dp-opt" onClick={onClick}>
            <span className="fm-check"><Check size={12} strokeWidth={3.2} aria-hidden="true" /></span>
            <span className="fm-opt-label">{label}</span>
        </button>
    );

    const body = (
        <>
            <div className="fm-search">
                <Search size={16} aria-hidden="true" />
                <input
                    ref={searchRef}
                    className="fm-search-input no-capitalize"
                    type="text"
                    value={query}
                    placeholder="Search people"
                    aria-label="Search people"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    onChange={(e) => setQuery(e.target.value)}
                />
            </div>
            <div className="fm-loc-list" role="group" aria-label="People">
                {!typed && row('me', justMe, 'Me', () => onChange([me]))}
                {!typed && row('team', team, 'My team', () => onChange([]))}
                {groups.map((g) => (
                    <div key={g.group} className="fm-loc-list" role="group" aria-label={g.group}>
                        <div className="fm-opt-group" aria-hidden="true">{g.group}</div>
                        {g.options.map((o: PersonOption & { you?: boolean }) => row(
                            o.value,
                            !team && value.includes(o.value),
                            <>{o.label}{o.inactive && <span className="fm-opt-branch"> · inactive</span>}</>,
                            () => onToggle(o.value)
                        ))}
                    </div>
                ))}
                {typed && groups.length === 0 && <div className="fm-menu-note">No one matches “{typed}”</div>}
            </div>
        </>
    );

    return (
        <div className="lf-group">
            <label className="lf-group-label" htmlFor={id}>People</label>
            <div
                ref={wrapRef}
                className="fm-pop fm-tokens fm-loc dp-people"
                onKeyDown={(e) => {
                    // Handled here: the Filters panel around it stays open.
                    if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); close(); }
                }}
            >
                <button
                    ref={triggerRef}
                    id={id}
                    type="button"
                    className="fm-picker-trigger"
                    aria-haspopup="dialog"
                    aria-expanded={open}
                    onClick={() => (open ? close() : setOpen(true))}
                >
                    <span className="fm-opt-text"><span className="fm-opt-label">{summary}</span></span>
                    <ChevronDown size={18} aria-hidden="true" />
                </button>
                {open && !sheet && (
                    <div ref={menuRef} className="fm-menu" data-placement={pos.placement} style={{ maxHeight: pos.maxHeight }}>{body}</div>
                )}
                {sheet && (
                    <FormSheet open={open} title="People" onClose={() => close()}>
                        {body}
                    </FormSheet>
                )}
            </div>
        </div>
    );
}
