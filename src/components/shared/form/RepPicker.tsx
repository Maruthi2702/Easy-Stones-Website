import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import useIsPhone from './useIsPhone';
import { describedBy, menuPlacement } from './formFocus';
import { FormSheet } from './FormControls';
import { groupRepOptions } from '../../../utils/salesReps';

/*
 * The one sales rep dropdown on every form (Selection Sheet, Delivery,
 * Location, Add / Edit customer), in the same format as the Customer List's
 * rep filter: a search box, "None" / "Unassigned" first, then reps grouped
 * under their branch with you marked "(you)" (groupRepOptions in
 * src/utils/salesReps.js). Same trigger and placement as FormPicker: floating
 * over the form on desktop, a bottom sheet on phones.
 *
 * `options` are { value, label, location, id? } — from useSalesRepOptions or
 * toSalesRepList. `noneLabel` adds the blank choice (omit it where a rep is
 * required). `you` is the signed-in person's id.
 */
/** A rep as the picker shows them (useSalesRepOptions / toSalesRepList). */
export type RepOption = { value: string; label: string; location?: string; id?: string };

export type RepPickerProps = {
    id: string;
    value?: string | null;
    onChange: (value: string) => void;
    options?: RepOption[];
    noneLabel?: string | null;
    placeholder?: string;
    sheetTitle?: string;
    you?: string;
    error?: unknown;
    disabled?: boolean;
};

export default function RepPicker({
    id, value, onChange, options = [], noneLabel = null, placeholder = 'Choose a sales rep',
    sheetTitle = 'Sales rep', you = '', error, disabled
}: RepPickerProps) {
    const isPhone = useIsPhone();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(0);
    const [pos, setPos] = useState<{ placement: 'up' | 'down'; maxHeight: number }>({ placement: 'down', maxHeight: 440 });
    const wrapRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const listId = `${id}-list`;

    const groups = useMemo(() => groupRepOptions(options, { you, query }), [options, you, query]);
    const showNone = noneLabel && !query.trim();
    // What the arrow keys move through, in the order on screen.
    const flat = useMemo<RepOption[]>(
        () => [...(showNone ? [{ value: '', label: noneLabel as string }] : []), ...groups.flatMap((g) => g.options)],
        [showNone, noneLabel, groups]
    );
    const selected = useMemo<RepOption | undefined>(
        () => groupRepOptions(options, { you }).flatMap((g) => g.options).find((o: RepOption) => o.value === value),
        [options, you, value]
    );

    const close = (refocus = true) => {
        setOpen(false);
        setQuery('');
        setActive(0);
        if (refocus) triggerRef.current?.focus({ preventScroll: true });
    };
    const choose = (v: string) => {
        onChange(v);
        close();
    };
    const openList = () => {
        const current = flat.findIndex((o) => o.value === (value ?? ''));
        setActive(current >= 0 ? current : 0);
        if (!isPhone) setPos(menuPlacement(triggerRef.current));
        setOpen(true);
    };

    useEffect(() => {
        if (!open || isPhone) return undefined;
        searchRef.current?.focus({ preventScroll: true });
        const onDown = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) close(false); };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [open, isPhone]);

    // Keep the highlighted row in view while arrowing through a long list.
    useEffect(() => {
        if (!open) return;
        document.getElementById(`${id}-opt-${active}`)?.scrollIntoView({ block: 'nearest' });
    }, [open, active, id]);

    const onSearchKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (flat.length) setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + flat.length) % flat.length);
        } else if (e.key === 'Enter') {
            // Enter picks the highlighted rep — never submits the form.
            e.preventDefault();
            if (flat[active]) choose(flat[active].value);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            close();
        } else if (e.key === 'Tab' && !isPhone) {
            close(false);
        }
    };

    const row = (o: RepOption) => {
        const i = flat.findIndex((f) => f.value === o.value);
        return (
            <button
                key={`${o.value}`}
                id={`${id}-opt-${i}`}
                type="button"
                role="option"
                className="fm-opt"
                aria-selected={o.value === (value ?? '')}
                data-active={i === active ? 'true' : undefined}
                tabIndex={-1}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(o.value)}
            >
                <span className="fm-opt-text"><span className="fm-opt-label">{o.label}</span></span>
                {o.value === (value ?? '') && <Check size={18} strokeWidth={2.6} aria-label="Selected" />}
            </button>
        );
    };

    const body = (
        <>
            <div className="fm-search">
                <Search size={16} aria-hidden="true" />
                <input
                    ref={searchRef}
                    className="fm-search-input no-capitalize"
                    type="text"
                    value={query}
                    placeholder="Search rep or branch"
                    aria-label={`Search ${sheetTitle}`}
                    aria-controls={listId}
                    aria-activedescendant={flat.length ? `${id}-opt-${active}` : undefined}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                    onKeyDown={onSearchKeyDown}
                />
            </div>
            <div role="listbox" id={listId} aria-label={sheetTitle}>
                {showNone && row({ value: '', label: noneLabel })}
                {groups.map((g) => (
                    <div key={g.group} role="group" aria-label={g.group}>
                        <div className="fm-opt-group" aria-hidden="true">{g.group}</div>
                        {g.options.map(row)}
                    </div>
                ))}
                {flat.length === 0 && <div className="fm-menu-note">No reps match “{query.trim()}”</div>}
            </div>
        </>
    );

    const shownLabel = value ? (selected?.label || value) : (noneLabel || '');
    const branch = value ? selected?.location : '';
    return (
        <div ref={wrapRef} className="fm-pop">
            <button
                ref={triggerRef}
                id={id}
                type="button"
                className="fm-picker-trigger"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={open ? listId : undefined}
                disabled={disabled}
                onClick={() => (open ? close() : openList())}
                onKeyDown={(e) => {
                    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                        e.preventDefault();
                        openList();
                    }
                }}
                {...describedBy(id, error)}
            >
                <span className="fm-opt-text">
                    {shownLabel ? (
                        <span className="fm-opt-label">
                            {shownLabel}
                            {branch && <span className="fm-opt-branch"> · {branch}</span>}
                        </span>
                    ) : (
                        <span className="fm-placeholder">{placeholder}</span>
                    )}
                </span>
                <ChevronDown size={18} aria-hidden="true" />
            </button>
            {open && !isPhone && (
                <div className="fm-menu" data-placement={pos.placement} style={{ maxHeight: pos.maxHeight }}>{body}</div>
            )}
            {isPhone && (
                <FormSheet open={open} title={sheetTitle} onClose={() => close()}>
                    {body}
                </FormSheet>
            )}
        </div>
    );
}
