import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import useIsPhone from './useIsPhone';
import { FormSheet } from './FormControls';
import { clipParentOf, useMenuPlacement } from './formFocus';
import { groupRepOptions } from '../../../utils/salesReps';
import './FormModal.css';
import './RepFilterPicker.css';

/*
 * The one multi-choice sales rep dropdown — for any filter that ticks several
 * reps (Route Planner's Filter; meant for every new rep filter). The format
 * every rep dropdown shares (CLAUDE.md, "Sales reps"): the field says who is
 * ticked; its list has a search box, optional All / None, the rows that come
 * before the reps (Unassigned, Me, My team… — `extras`, hidden while
 * searching), then the reps as checkboxes under a heading for their branch
 * (branches and names A–Z, "Other" last) with you marked "(you)"
 * (groupRepOptions), each with an optional count. The list stays open while
 * you tick. It floats under the field, inside whatever holds it (never
 * portaled — the CustomSelect incident), capped to the room there is; on
 * phones it's the form template's bottom sheet unless `phoneSheet` is false
 * (a panel the sheet would end up under, like the Route Planner's).
 *
 * RepPicker is the single-choice one, for forms.
 */

/** A rep as the list shows them (useSalesRepOptions / toSalesRepList / a screen's own). */
export type RepFilterOption = { value: string; label: string; location?: string; id?: string; inactive?: boolean };

/** A row above the reps: Unassigned, Me, My team… */
export type RepFilterExtra = { value: string; label: ReactNode; checked: boolean; onClick: () => void; count?: number };

export type RepFilterPickerProps = {
    /** The field's label, the sheet's title and the list's name ("Sales reps"). */
    label: string;
    /** Don't draw the label above the field (the screen has its own heading). */
    hideLabel?: boolean;
    options: RepFilterOption[];
    /** The ticked reps' values. */
    selected: string[];
    onToggle: (value: string) => void;
    /** The signed-in person's id, marked "(you)". */
    you?: string;
    /** A number beside each row (customers, visits…), by value. */
    counts?: Record<string, number>;
    extras?: RepFilterExtra[];
    onAll?: () => void;
    onNone?: () => void;
    /** What the closed field says; by default All / None / a name / "3 of 14". */
    summary?: ReactNode;
    /** A line under the list (whose reps these are). */
    note?: ReactNode;
    searchPlaceholder?: string;
    phoneSheet?: boolean;
};

/** The closed field's words when the screen doesn't give its own. */
function repFilterSummary(selected: string[], options: RepFilterOption[]): string {
    const on = options.filter(o => selected.includes(o.value));
    if (!options.length || on.length === 0) return 'None';
    if (on.length === options.length) return options.length === 1 ? on[0].label : 'All reps';
    if (on.length === 1) return on[0].label;
    return `${on.length} of ${options.length} reps`;
}

export default function RepFilterPicker({
    label, hideLabel = false, options, selected, onToggle, you = '', counts, extras = [],
    onAll, onNone, summary, note, searchPlaceholder = 'Search reps', phoneSheet = true
}: RepFilterPickerProps) {
    const id = useId();
    const isPhone = useIsPhone();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const wrapRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const usesSheet = isPhone && phoneSheet;
    const pos = useMenuPlacement(open, usesSheet, triggerRef, menuRef, clipParentOf);
    const sheet = usesSheet || pos.placement === 'sheet';

    const groups = useMemo(() => groupRepOptions(options, { you, query }), [options, you, query]);
    const typed = query.trim();
    const shownSummary = summary ?? repFilterSummary(selected, options);

    const close = (refocus = true) => {
        setOpen(false);
        setQuery('');
        if (refocus) triggerRef.current?.focus({ preventScroll: true });
    };

    useEffect(() => {
        if (!open || sheet) return undefined;
        // Not on a phone: the keyboard would cover the list it just opened.
        if (!isPhone) searchRef.current?.focus({ preventScroll: true });
        const onDown = (e: MouseEvent | TouchEvent) => { if (!wrapRef.current?.contains(e.target as Node)) close(false); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('touchstart', onDown);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('touchstart', onDown);
        };
    }, [open, sheet, isPhone]);

    const row = (key: string, on: boolean, text: ReactNode, onClick: () => void, count?: number) => (
        <button key={key} type="button" role="checkbox" aria-checked={on} className="fm-opt rfp-opt" onClick={onClick}>
            <span className="fm-check"><Check size={12} strokeWidth={3.2} aria-hidden="true" /></span>
            <span className="fm-opt-label rfp-opt-label">{text}</span>
            {count !== undefined && <span className="rfp-count">{count}</span>}
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
                    placeholder={searchPlaceholder}
                    aria-label={searchPlaceholder}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    onChange={(e) => setQuery(e.target.value)}
                />
            </div>
            {!typed && (onAll || onNone) && (
                <div className="rfp-actions">
                    {onAll && <button type="button" className="rfp-link" onClick={onAll}>All</button>}
                    {onNone && <button type="button" className="rfp-link" onClick={onNone}>None</button>}
                </div>
            )}
            <div className="fm-loc-list" role="group" aria-label={label}>
                {!typed && extras.map(x => row(`extra:${x.value}`, x.checked, x.label, x.onClick, x.count))}
                {groups.map((g) => (
                    <div key={g.group} className="fm-loc-list" role="group" aria-label={g.group}>
                        <div className="fm-opt-group" aria-hidden="true">{g.group}</div>
                        {g.options.map((o: RepFilterOption) => row(
                            o.value,
                            selected.includes(o.value),
                            <>{o.label}{o.inactive && <span className="fm-opt-branch"> · inactive</span>}</>,
                            () => onToggle(o.value),
                            counts ? (counts[o.value] ?? 0) : undefined
                        ))}
                    </div>
                ))}
                {groups.length === 0 && (typed || !extras.length) && (
                    <div className="fm-menu-note">{typed ? `No reps match “${typed}”` : 'No reps to show.'}</div>
                )}
            </div>
            {note && <div className="fm-menu-note rfp-note">{note}</div>}
        </>
    );

    return (
        <div className="rfp-field">
            {!hideLabel && <label className="rfp-label" htmlFor={id}>{label}</label>}
            <div
                ref={wrapRef}
                className="fm-pop fm-tokens fm-loc rfp"
                onKeyDown={(e) => {
                    // Handled here so a panel or modal around it stays open.
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
                    aria-label={hideLabel ? label : undefined}
                    onClick={() => (open ? close() : setOpen(true))}
                >
                    <span className="fm-opt-text"><span className="fm-opt-label">{shownSummary}</span></span>
                    <ChevronDown size={18} aria-hidden="true" />
                </button>
                {open && !sheet && (
                    <div ref={menuRef} className="fm-menu" data-placement={pos.placement} style={{ maxHeight: pos.maxHeight }}>{body}</div>
                )}
                {sheet && (
                    <FormSheet open={open} title={label} onClose={() => close()}>
                        {body}
                    </FormSheet>
                )}
            </div>
        </div>
    );
}
