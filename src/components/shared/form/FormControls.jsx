import React, { useContext, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Check, ChevronDown, Eye, EyeOff, Plus, Search } from 'lucide-react';
import useIsPhone from './useIsPhone';
import { firstFocusableIn, describedBy, menuPlacement } from './formFocus';
import { FormLayerContext } from './formLayer';
import { matchesOption } from '../../../utils/customerOptions';

/*
 * The form template's controls (FORM_TEMPLATE.md → Fields). Styles live in
 * FormModal.css. Everything is 42px tall (46px on phones) so fields line up
 * across forms; the space under a field is only for an error or a live status
 * — no helper text.
 */

export function FormSection({ number, title, children }) {
    return (
        <section className="fm-section">
            {title && (
                <h3 className="fm-section-title">
                    {number != null && <span className="fm-section-num" aria-hidden="true">{number}</span>}
                    {title}
                </h3>
            )}
            {children}
        </section>
    );
}

/** Two columns on desktop, one on phones. */
export function FormRow({ children }) {
    return <div className="fm-row">{children}</div>;
}

/**
 * Label (+ red * when required), the control, then an error or a status.
 * `name` is what goToField / the error banner use to find it. Give the control
 * id={fieldIds(id).input} and aria-describedby={fieldIds(id).message} when
 * there's an error or status.
 */
export function FormField({ name, id, label, required = false, error = '', status = null, statusTone, children }) {
    return (
        <div className="fm-field" data-field={name}>
            <label className="fm-label" htmlFor={id}>
                {label}
                {required && <span className="fm-req" aria-hidden="true">*</span>}
            </label>
            {children}
            {error ? (
                <span className="fm-error" id={`${id}-msg`}>
                    <AlertCircle size={13} strokeWidth={2.4} aria-hidden="true" />{error}
                </span>
            ) : status ? (
                <span className="fm-status" id={`${id}-msg`} data-tone={statusTone} aria-live="polite">{status}</span>
            ) : null}
        </div>
    );
}

export function PasswordInput({ id, value, onChange, error, status, mono = true, ...rest }) {
    const [shown, setShown] = useState(false);
    return (
        <div className="fm-input-wrap">
            <input
                id={id}
                // no-capitalize: index.css title-cases text inputs, and a shown
                // password must read exactly as typed.
                className={`fm-input no-capitalize${mono ? ' fm-input-mono' : ''}`}
                type={shown ? 'text' : 'password'}
                value={value}
                onChange={onChange}
                autoComplete="new-password"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                {...describedBy(id, error, status)}
                {...rest}
            />
            <button
                type="button"
                className="fm-eye"
                aria-label={shown ? 'Hide password' : 'Show password'}
                aria-pressed={shown}
                onClick={() => setShown((v) => !v)}
            >
                {shown ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
            </button>
        </div>
    );
}

/** Two (or a few) mutually exclusive choices, e.g. Temporary password / Email an invite. */
export function SegmentedToggle({ label, value, onChange, options }) {
    const refs = useRef([]);
    const onKeyDown = (e, i) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const next = (i + (e.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length;
        onChange(options[next].value);
        refs.current[next]?.focus();
    };
    return (
        <div className="fm-seg" role="radiogroup" aria-label={label} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
            {options.map((o, i) => (
                <button
                    key={o.value}
                    ref={(el) => { refs.current[i] = el; }}
                    type="button"
                    role="radio"
                    className="fm-seg-btn"
                    aria-checked={value === o.value}
                    tabIndex={value === o.value ? 0 : -1}
                    onClick={() => onChange(o.value)}
                    onKeyDown={(e) => onKeyDown(e, i)}
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}

/**
 * Bottom sheet for phones: pickers open here instead of as a small list
 * inside the form, so the form body stays the only thing that scrolls. Closes
 * on Done, the backdrop, or Esc — never by swiping (FORM_TEMPLATE.md).
 */
export function FormSheet({ open, title, onClose, children, footer }) {
    const sheetRef = useRef(null);
    const titleId = useId();
    // Drawn at the form's top level, not inside the scrolling body, so it
    // covers the footer on iOS too (see formLayer.js).
    const layer = useContext(FormLayerContext);
    useEffect(() => {
        if (!open) return;
        const sheet = sheetRef.current;
        (firstFocusableIn(sheet?.querySelector('.fm-sheet-body')) || sheet)?.focus({ preventScroll: true });
    }, [open]);
    if (!open) return null;
    const sheet = (
        <>
            <div className="fm-sheet-backdrop" onClick={onClose} aria-hidden="true" />
            <div
                ref={sheetRef}
                className="fm-sheet"
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                data-fm-layer=""
                onKeyDown={(e) => {
                    if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
                }}
            >
                <div className="fm-sheet-head">
                    <h3 className="fm-sheet-title" id={titleId}>{title}</h3>
                </div>
                <div className="fm-sheet-body">{children}</div>
                <div className="fm-sheet-foot">
                    {footer}
                    <span style={{ flex: 1 }} />
                    <button type="button" className="fm-btn fm-btn-primary fm-btn-small" onClick={onClose}>Done</button>
                </div>
            </div>
        </>
    );
    return layer ? createPortal(sheet, layer) : sheet;
}

/**
 * A dropdown whose options can carry a description line (roles, say). On
 * desktop the list floats over the fields under the picker (see .fm-menu in
 * FormModal.css — inside the form, never portaled, so a modal can't paint
 * over it: the CustomSelect incident in CLAUDE.md). On phones it's a bottom
 * sheet. An option with `disabled: true` is shown greyed out and skipped by
 * the arrow keys (a driver whose truck is full).
 */
export function FormPicker({ id, value, onChange, options, placeholder = 'Choose…', error, sheetTitle, disabled }) {
    const isPhone = useIsPhone();
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(-1);
    const [pos, setPos] = useState({ placement: 'down', maxHeight: 440 });
    const wrapRef = useRef(null);
    const triggerRef = useRef(null);
    const optionRefs = useRef([]);
    const listId = `${id}-list`;
    const selected = options.find((o) => o.value === value);

    const close = (refocus = true) => {
        setOpen(false);
        setActive(-1);
        if (refocus) triggerRef.current?.focus({ preventScroll: true });
    };
    const choose = (v) => {
        onChange(v);
        close();
    };
    // The next option the arrow keys can land on, skipping disabled ones.
    const stepFrom = (from, step) => {
        let i = from;
        for (let n = 0; n < options.length; n++) {
            i = (i + step + options.length) % options.length;
            if (!options[i].disabled) return i;
        }
        return from;
    };
    const openList = () => {
        const current = options.findIndex((o) => o.value === value);
        setActive(current >= 0 && !options[current].disabled ? current : stepFrom(-1, 1));
        if (!isPhone) setPos(menuPlacement(triggerRef.current));
        setOpen(true);
    };

    // Desktop: a click anywhere outside the field closes the inline list.
    useEffect(() => {
        if (!open || isPhone) return;
        const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) close(false); };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [open, isPhone]);

    useEffect(() => {
        if (open && active >= 0) optionRefs.current[active]?.focus({ preventScroll: false });
    }, [open, active]);

    const onListKeyDown = (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const step = e.key === 'ArrowDown' ? 1 : -1;
            setActive((i) => stepFrom(i, step));
        } else if (e.key === 'Home' || e.key === 'End') {
            e.preventDefault();
            setActive(e.key === 'Home' ? stepFrom(-1, 1) : stepFrom(options.length, -1));
        } else if (e.key === 'Escape') {
            e.stopPropagation();
            close();
        } else if (e.key === 'Tab' && !isPhone) {
            close(false);
        }
    };

    const list = (
        <div
            className={isPhone ? undefined : 'fm-menu'}
            data-placement={isPhone ? undefined : pos.placement}
            style={isPhone ? undefined : { maxHeight: pos.maxHeight }}
            role="listbox"
            id={listId}
            aria-label={sheetTitle}
            onKeyDown={onListKeyDown}
        >
            {options.map((o, i) => (
                <button
                    key={o.value}
                    ref={(el) => { optionRefs.current[i] = el; }}
                    type="button"
                    role="option"
                    className="fm-opt"
                    aria-selected={o.value === value}
                    data-active={i === active ? 'true' : undefined}
                    tabIndex={i === active ? 0 : -1}
                    disabled={o.disabled || undefined}
                    onClick={() => choose(o.value)}
                >
                    <span className="fm-opt-text">
                        <span className="fm-opt-label">{o.label}</span>
                        {o.description && <span className="fm-opt-desc">{o.description}</span>}
                    </span>
                    {o.value === value && <Check size={18} strokeWidth={2.6} aria-label="Selected" />}
                </button>
            ))}
        </div>
    );

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
                    {selected ? (
                        <>
                            <span className="fm-opt-label">{selected.label}</span>
                            {selected.description && <span className="fm-opt-desc">{selected.description}</span>}
                        </>
                    ) : (
                        <span className="fm-placeholder">{placeholder}</span>
                    )}
                </span>
                <ChevronDown size={18} aria-hidden="true" />
            </button>
            {open && !isPhone && list}
            {isPhone && (
                <FormSheet open={open} title={sheetTitle} onClose={() => close()}>
                    {list}
                </FormSheet>
            )}
        </div>
    );
}

/**
 * FormPicker with a search box, for long lists (customers). Same placement
 * rules: floating over the form on desktop, a bottom sheet on phones. Only
 * the first `maxResults` matches are drawn — typing narrows the rest — so a
 * few thousand customers don't make the form slow to open. `onCreateNew`
 * adds a "New …" row under the matches and is called with what was typed;
 * `createNewLabel` may be a function of that text, returning null to hide the
 * row (the Delivery form only offers "Use “…”" once something is typed).
 * `selectedLabel` is shown while the options are still loading (an edit
 * opened before the list arrived).
 */
export function FormSearchPicker({
    id, value, onChange, options, placeholder = 'Search…', searchPlaceholder = 'Type a name',
    error, sheetTitle, loading = false, onCreateNew, createNewLabel = 'New', selectedLabel = '',
    maxResults = 50, disabled
}) {
    const isPhone = useIsPhone();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(0);
    const [pos, setPos] = useState({ placement: 'down', maxHeight: 440 });
    const wrapRef = useRef(null);
    const triggerRef = useRef(null);
    const searchRef = useRef(null);
    const openList = () => {
        if (!isPhone) setPos(menuPlacement(triggerRef.current));
        setOpen(true);
    };
    const listId = `${id}-list`;
    const selected = options.find((o) => o.value === value);

    // Name, the line under it, and any keywords (a customer's contact and
    // city) — the same search SearchableSelect uses (customerOptions.js).
    const matches = query.trim() ? options.filter((o) => matchesOption(o, query)) : options;
    const shown = matches.slice(0, maxResults);
    const newLabel = typeof createNewLabel === 'function' ? createNewLabel(query.trim()) : createNewLabel;

    const close = (refocus = true) => {
        setOpen(false);
        setQuery('');
        setActive(0);
        if (refocus) triggerRef.current?.focus({ preventScroll: true });
    };
    const choose = (v) => {
        onChange(v);
        close();
    };

    useEffect(() => {
        if (!open || isPhone) return;
        searchRef.current?.focus({ preventScroll: true });
        const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) close(false); };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [open, isPhone]);

    const onSearchKeyDown = (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (shown.length) setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length);
        } else if (e.key === 'Enter') {
            // Enter picks the highlighted match — never submits the form.
            e.preventDefault();
            if (shown[active]) choose(shown[active].value);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            close();
        } else if (e.key === 'Tab' && !isPhone) {
            close(false);
        }
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
                    placeholder={searchPlaceholder}
                    aria-label={`Search ${sheetTitle || ''}`.trim()}
                    aria-controls={listId}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                    onKeyDown={onSearchKeyDown}
                />
            </div>
            <div role="listbox" id={listId} aria-label={sheetTitle}>
                {loading ? (
                    <div className="fm-menu-note">Loading…</div>
                ) : shown.length === 0 ? (
                    <div className="fm-menu-note">No matches</div>
                ) : shown.map((o, i) => (
                    <button
                        key={o.value}
                        type="button"
                        role="option"
                        className="fm-opt"
                        aria-selected={o.value === value}
                        data-active={i === active ? 'true' : undefined}
                        tabIndex={-1}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => choose(o.value)}
                    >
                        <span className="fm-opt-text">
                            <span className="fm-opt-label">{o.label}</span>
                            {o.description && <span className="fm-opt-desc">{o.description}</span>}
                        </span>
                        {o.value === value && <Check size={18} strokeWidth={2.6} aria-label="Selected" />}
                    </button>
                ))}
                {!loading && matches.length > shown.length && (
                    <div className="fm-menu-note">{`Showing ${shown.length} of ${matches.length} — type to narrow`}</div>
                )}
            </div>
            {onCreateNew && newLabel && (
                <button type="button" className="fm-opt fm-opt-new" onClick={() => { const typed = query.trim(); close(false); onCreateNew(typed); }}>
                    <Plus size={18} aria-hidden="true" />
                    <span className="fm-opt-label">{newLabel}</span>
                </button>
            )}
        </>
    );

    const label = selected?.label || selectedLabel;
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
                <Search size={16} aria-hidden="true" className="fm-trigger-icon" />
                <span className="fm-opt-text">
                    {label ? (
                        <>
                            <span className="fm-opt-label">{label}</span>
                            {selected?.description && <span className="fm-opt-desc">{selected.description}</span>}
                        </>
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
