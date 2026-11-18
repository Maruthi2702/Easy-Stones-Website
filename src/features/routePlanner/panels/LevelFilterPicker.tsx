import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { FormSheet } from '../../../components/shared/form/FormControls';
import { clipParentOf, useMenuPlacement } from '../../../components/shared/form/formFocus';
import { LEVELS, levelLabel } from '../helpers';
import type { Toggles } from '../types';
import '../../../components/shared/form/FormModal.css';
import '../../../components/shared/form/RepFilterPicker.css';

/**
 * The Route Planner Filter's Level dropdown: ticks several of Level 1–4, shown
 * under Sales reps in the same format (a closed field that says what's ticked,
 * a list that floats inside the panel and stays open while you tick, All /
 * None, a count per row). The same classes as RepFilterPicker so the two read
 * as a pair; there's no search (four rows) and no branch headings.
 */
export type LevelFilterPickerProps = {
    active: Toggles;
    counts: Record<string, number>;
    onToggle: (level: string) => void;
    onAll: () => void;
    onNone: () => void;
};

/** What the closed field says: "All levels", "No levels", "Level 2", "2 of 4 levels". */
export const levelSummary = (active: Toggles) => {
    const on = LEVELS.filter(l => active[l] !== false);
    if (on.length === LEVELS.length) return 'All levels';
    if (on.length === 0) return 'No levels';
    if (on.length === 1) return levelLabel(on[0]);
    return `${on.length} of ${LEVELS.length} levels`;
};

export default function LevelFilterPicker({ active, counts, onToggle, onAll, onNone }: LevelFilterPickerProps) {
    const id = useId();
    const [open, setOpen] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const pos = useMenuPlacement(open, false, triggerRef, menuRef, clipParentOf);
    const sheet = pos.placement === 'sheet';

    const close = (refocus = true) => {
        setOpen(false);
        if (refocus) triggerRef.current?.focus({ preventScroll: true });
    };

    useEffect(() => {
        if (!open || sheet) return undefined;
        const onDown = (e: MouseEvent | TouchEvent) => { if (!wrapRef.current?.contains(e.target as Node)) close(false); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('touchstart', onDown);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('touchstart', onDown);
        };
    }, [open, sheet]);

    const body = (
        <>
            <div className="rfp-actions">
                <button type="button" className="rfp-link" onClick={onAll}>All</button>
                <button type="button" className="rfp-link" onClick={onNone}>None</button>
            </div>
            <div className="fm-loc-list" role="group" aria-label="Level">
                {LEVELS.map(level => (
                    <button
                        key={level}
                        type="button"
                        role="checkbox"
                        aria-checked={active[level] !== false}
                        className="fm-opt rfp-opt"
                        onClick={() => onToggle(level)}
                    >
                        <span className="fm-check"><Check size={12} strokeWidth={3.2} aria-hidden="true" /></span>
                        <span className="fm-opt-label rfp-opt-label">{levelLabel(level)}</span>
                        <span className="rfp-count">{counts[level] ?? 0}</span>
                    </button>
                ))}
            </div>
        </>
    );

    return (
        <div className="rfp-field">
            <div
                ref={wrapRef}
                className="fm-pop fm-tokens fm-loc rfp"
                onKeyDown={(e) => {
                    // Handled here so the panel around it stays open.
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
                    aria-label="Level"
                    onClick={() => (open ? close() : setOpen(true))}
                >
                    <span className="fm-opt-text"><span className="fm-opt-label">{levelSummary(active)}</span></span>
                    <ChevronDown size={18} aria-hidden="true" />
                </button>
                {open && !sheet && (
                    <div ref={menuRef} className="fm-menu" data-placement={pos.placement} style={{ maxHeight: pos.maxHeight }}>{body}</div>
                )}
                {sheet && (
                    <FormSheet open={open} title="Level" onClose={() => close()}>
                        {body}
                    </FormSheet>
                )}
            </div>
        </div>
    );
}
