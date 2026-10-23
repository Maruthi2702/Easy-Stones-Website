import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import useIsPhone from './useIsPhone';
import { describedBy, menuPlacement } from './formFocus';
import { FormSheet } from './FormControls';
import {
    homeLocationOf, orderLocations, matchLocations, LOCATION_SEARCH_FROM
} from '../../../utils/locationFilter';
import './FormModal.css';

/*
 * The one location dropdown (owner's call, 2026-10-17): every single-choice
 * location field and filter in the app uses it — the Filters panels
 * (LocationFilter's LocationField), the forms (customer, delivery transfer,
 * freight, cart, location RDC, lost sale) and the check-in pages. A new one
 * uses it too; don't build a location <select> or FormPicker by hand.
 *
 * The list: the blank choice ("All locations" on a filter, `noneLabel` on a
 * form that allows none), then the home location marked "· Home", then every
 * other location A–Z, with a search box from LOCATION_SEARCH_FROM choices —
 * orderLocations / matchLocations in src/utils/locationFilter.js. A saved
 * value that's no longer offered stays in the list, so editing an old record
 * never blanks it.
 *
 * Same trigger and placement as FormPicker: the list floats under the field
 * on desktop (inside its container, never portaled — the CustomSelect
 * incident in CLAUDE.md), a bottom sheet on phones. Outside a form it carries
 * its own colours (.fm-tokens) and measures against whatever box would clip
 * it, so it also works in a Filters panel or an older modal. Because the list
 * is inside the field's own element, a Filters panel's click-outside check
 * sees a pick as a click inside the panel and stays open.
 *
 * `options` are names or Location documents. `home` defaults to the signed-in
 * `user`'s home location; pass it to put another branch first (the Daily
 * Report's own branch). `labelOf` changes how a name reads (a branch code).
 */

// The nearest ancestor that would cut the list off, if it isn't a form body.
const clipParentOf = (el: Element | null | undefined): HTMLElement | null => {
    for (let node = el?.parentElement; node && node !== document.body; node = node.parentElement) {
        const { overflowY } = window.getComputedStyle(node);
        if (overflowY !== 'visible') return node;
    }
    return null;
};

export type LocationPickerProps = {
    id: string;
    value?: string | null;
    onChange?: (value: string) => void;
    /** Location names or Location documents. */
    options?: unknown[];
    user?: unknown;
    home?: string;
    allLabel?: string | null;
    noneLabel?: string | null;
    placeholder?: string;
    sheetTitle?: string;
    labelOf?: ((name: string) => string) | null;
    error?: unknown;
    disabled?: boolean;
    className?: string;
};

export default function LocationPicker({
    id, value, onChange, options = [], user = null, home: homeProp,
    allLabel = null, noneLabel = null, placeholder = 'Choose a location',
    sheetTitle = 'Location', labelOf = null, error, disabled, className = ''
}: LocationPickerProps) {
    const isPhone = useIsPhone();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(0);
    const [pos, setPos] = useState<{ placement: 'up' | 'down'; maxHeight: number }>({ placement: 'down', maxHeight: 440 });
    const wrapRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const listId = `${id}-list`;

    const current = typeof value === 'string' ? value : '';
    const home: string = homeProp ?? homeLocationOf(user);
    const blankLabel = allLabel ?? noneLabel;
    const names = useMemo<string[]>(
        () => orderLocations(current ? [...options, current] : options, home),
        [options, current, home]
    );
    const searchable = names.length + (blankLabel ? 1 : 0) >= LOCATION_SEARCH_FROM;
    const typed = query.trim();
    const shown = useMemo<string[]>(() => matchLocations(names, typed), [names, typed]);
    const showBlank = Boolean(blankLabel) && !typed;
    const homeShown = Boolean(home) && shown[0] === home;
    // What the arrow keys move through, in the order on screen.
    const flat = useMemo(
        () => [...(showBlank ? [''] : []), ...shown],
        [showBlank, shown]
    );

    const nameFor = (n: string) => (labelOf ? labelOf(n) : n);

    const close = (refocus = true) => {
        setOpen(false);
        setQuery('');
        setActive(0);
        if (refocus) triggerRef.current?.focus({ preventScroll: true });
    };
    const choose = (v: string) => {
        onChange?.(v);
        close();
    };
    const openList = () => {
        const at = flat.indexOf(current);
        setActive(at >= 0 ? at : 0);
        if (!isPhone) {
            const anchor = triggerRef.current;
            setPos(anchor?.closest('.fm-body, .fm-sheet-body')
                ? menuPlacement(anchor)
                : menuPlacement(anchor, 440, clipParentOf(anchor)));
        }
        setOpen(true);
    };

    useEffect(() => {
        if (!open || isPhone) return undefined;
        (searchRef.current || listRef.current)?.focus({ preventScroll: true });
        const onDown = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) close(false); };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [open, isPhone]);

    // Keep the highlighted row in view while arrowing through a long list —
    // by scrolling the list only. scrollIntoView would scroll every box
    // around it too, and body is one (index.css), so opening the list jumped
    // the page (and a Filters panel with it) under the pointer.
    useEffect(() => {
        if (!open) return;
        const row = document.getElementById(`${id}-opt-${active}`);
        const box = row?.closest('.fm-menu, .fm-sheet-body');
        if (!row || !box) return;
        const r = row.getBoundingClientRect();
        const b = box.getBoundingClientRect();
        const covered = box.querySelector<HTMLElement>(':scope > .fm-search')?.offsetHeight || 0; // the sticky search box
        if (r.top < b.top + covered) box.scrollTop -= b.top + covered - r.top;
        else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom;
    }, [open, active, id]);

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (flat.length) setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + flat.length) % flat.length);
        } else if (e.key === 'Enter') {
            // Enter picks the highlighted location — never submits the form.
            e.preventDefault();
            if (active < flat.length) choose(flat[active]);
        } else if (e.key === 'Escape') {
            // Handled here: a Filters panel around it stays open.
            e.preventDefault();
            e.stopPropagation();
            close();
        } else if (e.key === 'Tab' && !isPhone) {
            close(false);
        }
    };

    const row = (v: string, i: number) => (
        <button
            key={v || '__blank'}
            id={`${id}-opt-${i}`}
            type="button"
            role="option"
            className="fm-opt"
            aria-selected={v === current}
            data-active={i === active ? 'true' : undefined}
            tabIndex={-1}
            onMouseEnter={() => setActive(i)}
            onClick={() => choose(v)}
        >
            <span className="fm-opt-text">
                <span className="fm-opt-label">
                    {v ? nameFor(v) : blankLabel}
                    {v && v === home && <span className="fm-opt-branch"> · Home</span>}
                </span>
            </span>
            {v === current && <Check size={18} strokeWidth={2.6} aria-label="Selected" />}
        </button>
    );

    const offset = showBlank ? 1 : 0;
    const body = (
        <>
            {searchable && (
                <div className="fm-search">
                    <Search size={16} aria-hidden="true" />
                    <input
                        ref={searchRef}
                        className="fm-search-input no-capitalize"
                        type="text"
                        value={query}
                        placeholder="Search locations"
                        aria-label={`Search ${sheetTitle}`}
                        aria-controls={listId}
                        aria-activedescendant={flat.length ? `${id}-opt-${active}` : undefined}
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                        onKeyDown={onKeyDown}
                    />
                </div>
            )}
            <div
                ref={listRef}
                role="listbox"
                id={listId}
                aria-label={sheetTitle}
                tabIndex={searchable ? undefined : -1}
                aria-activedescendant={!searchable && flat.length ? `${id}-opt-${active}` : undefined}
                onKeyDown={searchable ? undefined : onKeyDown}
                className="fm-loc-list"
            >
                {showBlank && row('', 0)}
                {shown.map((n, i) => (
                    <React.Fragment key={n}>
                        {i === 1 && homeShown && <div className="fm-loc-divider" aria-hidden="true" />}
                        {row(n, i + offset)}
                    </React.Fragment>
                ))}
                {flat.length === 0 && <div className="fm-menu-note">No locations match “{typed}”</div>}
            </div>
        </>
    );

    return (
        <div ref={wrapRef} className={`fm-pop fm-tokens fm-loc ${className}`.trim()}>
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
                    {current || blankLabel ? (
                        <span className="fm-opt-label">
                            {current ? nameFor(current) : blankLabel}
                            {current && current === home && <span className="fm-opt-branch"> · Home</span>}
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
