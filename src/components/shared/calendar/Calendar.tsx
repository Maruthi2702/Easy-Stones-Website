import React, { useEffect, useId, useRef, useState } from 'react';
import { Calendar as CalendarIcon, ChevronDown, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import useIsPhone from '../form/useIsPhone';
import { describedBy } from '../form/formFocus';
import { FormSheet } from '../form/FormControls';
import {
    WEEK_STARTS_ON, MONTH_NAMES, MONTH_SHORT,
    todayISO, parseISO, parseMonth, parseYear, isValidISO,
    shiftDay, shiftMonth, withMonth, weekdayLabels, monthGrid, weekBounds, decadeStart, yearCells,
    dayOutside, monthOutside, yearOutside, clampDay,
    formatDateText, formatDateLong, formatMonthText, dayAfterKey,
    readDateTime, roundedNow, clockParts, withClock, withDay, localDateTime, formatTimeText
} from './calendarDates';
import '../form/FormModal.css';
import './Calendar.css';

/*
 * The one calendar (owner's call, 2026-10-17): every date, month and year
 * field in the app is one of these — never a native <input type="date">, and
 * never a new picker built by hand. The look was approved on the claude.ai
 * artifact "Calendar picker canvas" (https://claude.ai/artifact/5kTECs8HvXNyPAnHTMHg3a).
 *
 *   <DatePicker value="2026-10-20" onChange={(iso) => …} />       Date
 *   <MonthPicker value="2026-10" onChange={(ym) => …} />          Month
 *   <YearPicker value="2026" onChange={(year) => …} />            Year
 *   <DateTimePicker value="2026-10-20T09:30:00.000" … />          Date + time
 *
 * Values are plain strings ('' for none) and onChange gets the string itself,
 * not an event. The date rules live in calendarDates.js (with tests), the look
 * in Calendar.css — a calendar bug is in one of these three files.
 *
 * Opening: the calendar floats under its field on desktop and opens as a
 * bottom sheet on phones — or, on desktop, whenever the box around the field
 * (a modal body, a scrolling panel) has no room for it, so it is never cut
 * off. It is drawn inside its field, never portaled (the CustomSelect incident
 * in CLAUDE.md). Pick → it closes; Esc closes without handing the Esc to the
 * form around it.
 *
 * Header: in a Date calendar the month and the year are buttons — the month
 * opens the Month grid, the year opens the Year grid, and picking one returns
 * to the days. Keys: arrows (a day / a week), PageUp / PageDown (a month,
 * with Shift a year), Home / End (ends of the week), Enter picks.
 *
 * Props every picker takes: id, value, onChange, min / max (a bound in the
 * picker's own format; days or months outside are shown struck out and can't be
 * picked), error (red border; the message is the form field's), disabled,
 * placeholder, shortcuts ([{ label, value }] — replaces the default Today /
 * This month / This year; [] for none), clearable (a Clear button that sends
 * ''), onBlur (when the field is left — forms use it for "touched"), variant
 * ('field' — a form-sized field, or 'bare' — plain text a screen styles with
 * `triggerClassName`), formatText (how the field reads the value), today
 * ("YYYY-MM-DD" — for a screen that runs on a branch's clock, not the viewer's;
 * it marks today and is what the default Today button picks).
 */

const PANEL_HEIGHT = 400; // the tallest the calendar gets, with its shortcuts
const PANEL_WIDTH = 320;

type Placement = { kind: 'float'; vertical: 'up' | 'down'; align: 'left' | 'right' } | { kind: 'sheet' };
type Shortcut = { label: string; value: string };
/** The props every picker field takes (DatePicker, MonthPicker, YearPicker). */
type FieldProps = {
    id?: string;
    error?: unknown;
    status?: unknown;
    disabled?: boolean;
    placeholder?: string;
    shortcuts?: Shortcut[];
    clearable?: boolean;
    onBlur?: () => void;
    variant?: 'field' | 'bare';
    className?: string;
    triggerClassName?: string;
    sheetTitle?: string;
    ariaLabel?: string;
    icon?: 'clock' | 'none';
    /** A screen on a branch's clock passes its today ('YYYY-MM-DD'). */
    today?: string;
    min?: string;
    max?: string;
};

const pad = (n: number): string => String(n).padStart(2, '0');

// ── Where the calendar opens ───────────────────────────────────────────────

/**
 * Float below / above / aligned left or right of the field, or fall back to a
 * sheet — measured against the window and every ancestor that would clip it.
 */
function choosePlacement(anchor: HTMLElement | null, width = PANEL_WIDTH, height = PANEL_HEIGHT): Placement {
    if (!anchor) return { kind: 'float', vertical: 'down', align: 'left' };
    let box = { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight };
    for (let node = anchor.parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
        const { overflowX, overflowY } = window.getComputedStyle(node);
        if (overflowX === 'visible' && overflowY === 'visible') continue;
        const r = node.getBoundingClientRect();
        box = {
            top: Math.max(box.top, r.top), left: Math.max(box.left, r.left),
            right: Math.min(box.right, r.right), bottom: Math.min(box.bottom, r.bottom)
        };
    }
    const a = anchor.getBoundingClientRect();
    const below = box.bottom - a.bottom - 10;
    const above = a.top - box.top - 10;
    const vertical = below >= height ? 'down' : above >= height ? 'up' : null;
    const align = a.left + width <= box.right - 4 ? 'left' : a.right - width >= box.left + 4 ? 'right' : null;
    return vertical && align ? { kind: 'float', vertical, align } : { kind: 'sheet' };
}

// ── The shell: trigger, open/close, float or sheet ─────────────────────────

function PickerShell({
    id, text, placeholder, icon, disabled, error, status, className = '', triggerClassName = '',
    variant = 'field', ariaLabel, sheetTitle, onBlur, panelWidth = PANEL_WIDTH, panelHeight = PANEL_HEIGHT,
    panelLabel, children
}: Omit<FieldProps, 'shortcuts' | 'clearable' | 'today' | 'min' | 'max'> & {
    text: string;
    panelWidth?: number;
    panelHeight?: number;
    panelLabel?: string;
    children: (api: { close: (refocus?: boolean) => void; big: boolean }) => React.ReactNode;
}) {
    const isPhone = useIsPhone();
    const [open, setOpen] = useState(false);
    const [placement, setPlacement] = useState<Placement>({ kind: 'float', vertical: 'down', align: 'left' });
    const wrapRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);

    const close = (refocus = true) => {
        if (!open) return;
        setOpen(false);
        if (refocus) triggerRef.current?.focus({ preventScroll: true });
        onBlur?.();
    };
    const openPanel = () => {
        if (disabled) return;
        setPlacement(isPhone ? { kind: 'sheet' } : choosePlacement(triggerRef.current, panelWidth, panelHeight));
        setOpen(true);
    };

    useEffect(() => {
        if (!open || placement.kind !== 'float') return undefined;
        const onDown = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) close(false); };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- close is rebuilt every render; this effect only needs the current one while open
    }, [open, placement.kind]);

    // A field that gets disabled while open (a form saving) shuts the calendar.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a change of `disabled` should run this
    useEffect(() => { if (disabled && open) close(false); }, [disabled]);

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape' && open) {
            // Handled here: the form or Filters panel around it stays open.
            e.preventDefault();
            e.stopPropagation();
            close();
        }
    };
    const onFocusOut = (e: React.FocusEvent) => {
        // Tabbing out of an open calendar closes it. (A click on its padding
        // has no relatedTarget in Safari — mousedown handles real outside clicks.)
        if (open && placement.kind === 'float' && e.relatedTarget && !wrapRef.current?.contains(e.relatedTarget as Node)) close(false);
    };

    const panel = open ? children({ close, big: placement.kind === 'sheet' }) : null;
    const bare = variant === 'bare';

    return (
        <div
            ref={wrapRef}
            className={`cal-wrap fm-pop fm-tokens${bare ? ' cal-wrap-bare' : ''} ${className}`.trim()}
            onKeyDown={onKeyDown}
            onBlur={onFocusOut}
        >
            <button
                ref={triggerRef}
                id={id}
                type="button"
                className={bare ? `cal-bare ${triggerClassName}`.trim() : `fm-picker-trigger cal-trigger ${triggerClassName}`.trim()}
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-label={ariaLabel ? `${ariaLabel}${text ? `: ${text}` : ''}` : undefined}
                disabled={disabled}
                onClick={() => (open ? close() : openPanel())}
                onBlur={() => { if (!open) onBlur?.(); }}
                onKeyDown={(e) => {
                    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                        e.preventDefault();
                        openPanel();
                    }
                }}
                {...(id ? describedBy(id, error, status) : {})}
            >
                {bare ? (
                    <>
                        <span className="cal-bare-text">{text || placeholder}</span>
                        {icon === 'none' ? null : <ChevronDown size={14} className="cal-bare-chev" aria-hidden="true" />}
                    </>
                ) : (
                    <>
                        {icon === 'clock'
                            ? <Clock size={18} className="fm-trigger-icon" aria-hidden="true" />
                            : <CalendarIcon size={18} className="fm-trigger-icon" aria-hidden="true" />}
                        {text
                            ? <span className="cal-text">{text}</span>
                            : <span className="cal-text fm-placeholder">{placeholder}</span>}
                    </>
                )}
            </button>
            {open && placement.kind === 'float' && (
                <div
                    className="cal-float"
                    data-vertical={placement.kind === 'float' ? placement.vertical : undefined}
                    data-align={placement.kind === 'float' ? placement.align : undefined}
                    style={panelWidth === PANEL_WIDTH ? undefined : { width: panelWidth }}
                    role="dialog"
                    aria-label={panelLabel || sheetTitle}
                >
                    {panel}
                </div>
            )}
            {placement.kind === 'sheet' && (
                <FormSheet open={open} title={sheetTitle} onClose={() => close()}>
                    <div className="cal-sheet-center">{panel}</div>
                </FormSheet>
            )}
        </div>
    );
}

// ── The calendar itself (Date / Month / Year grids) ────────────────────────

const Chevron = ({ dir }: { dir: 'left' | 'right' }) => (dir === 'left'
    ? <ChevronLeft size={18} strokeWidth={2.2} aria-hidden="true" />
    : <ChevronRight size={18} strokeWidth={2.2} aria-hidden="true" />);

/**
 * The calendar body. `mode` is what gets picked: 'date' (days, with the month
 * and year grids a click away), 'month' or 'year'. `value` is in the mode's
 * own format; `onPick` gets the new value in it.
 */
export type CalendarMode = 'date' | 'month' | 'year';

export function CalendarPanel({
    mode = 'date', value = '', onPick, onClear, min = '', max = '', shortcuts, clearable = false,
    highlightWeek = false, weekStart = WEEK_STARTS_ON, big = false, today: todayProp
}: {
    mode?: CalendarMode; value?: string; onPick: (value: string) => void; onClear?: () => void;
    min?: string; max?: string; shortcuts?: Shortcut[]; clearable?: boolean;
    highlightWeek?: boolean; weekStart?: number; big?: boolean; today?: string;
}) {
    const today: string = isValidISO(todayProp) ? (todayProp as string) : todayISO();
    const rootRef = useRef<HTMLDivElement>(null);
    const focusNext = useRef(true); // move real focus to the cell after the next render

    const startDay = (() => {
        if (mode === 'date' && isValidISO(value)) return value.slice(0, 10);
        return clampDay(today, min, max);
    })();
    const startParts = parseISO(startDay)!;
    const [view, setView] = useState<'day' | 'month' | 'year'>(mode === 'date' ? 'day' : mode);
    const [curY, setCurY] = useState(() => {
        if (mode === 'month') return parseMonth(value)?.y ?? startParts.y;
        if (mode === 'year') return parseYear(value) ?? startParts.y;
        return startParts.y;
    });
    const [curM, setCurM] = useState(startParts.m);
    const [focusIso, setFocusIso] = useState(startDay);
    const [dec, setDec] = useState(() => decadeStart(mode === 'year' ? (parseYear(value) ?? startParts.y) : startParts.y));

    useEffect(() => {
        if (!focusNext.current) return;
        focusNext.current = false;
        const root = rootRef.current;
        if (!root) return;
        const target = view === 'day'
            ? root.querySelector<HTMLElement>(`[data-iso="${focusIso}"]:not(:disabled)`)
            : root.querySelector<HTMLElement>('[data-cell][tabindex="0"]:not(:disabled)') || root.querySelector<HTMLElement>('[data-cell]:not(:disabled)');
        target?.focus({ preventScroll: true });
    });

    const selectedDay = mode === 'date' && isValidISO(value) ? value.slice(0, 10) : '';
    const selectedMonth = mode === 'month' ? (parseMonth(value) ? value : '') : '';
    const selectedYear = mode === 'year' ? parseYear(value) : null;
    const week = highlightWeek && selectedDay ? weekBounds(selectedDay, weekStart) : null;
    const dateMode = mode === 'date';

    // ── Moving between months / years / decades ──
    const showMonthOf = (iso: string) => {
        const p = parseISO(iso)!;
        setCurY(p.y);
        setCurM(p.m);
        setFocusIso(iso);
    };
    const step = (dir: number) => {
        if (view === 'day') {
            const next = shiftMonth(`${curY}-${pad(curM + 1)}-01`, dir);
            const p = parseISO(next)!;
            setCurY(p.y);
            setCurM(p.m);
            setFocusIso(withMonth(focusIso, next.slice(0, 7)));
        } else if (view === 'month') {
            setCurY(curY + dir);
        } else {
            setDec(dec + 10 * dir);
        }
    };
    const stepDisabled = (dir: number) => {
        if (view === 'day') {
            const first = `${curY}-${pad(curM + 1)}-01`;
            return dir < 0 ? Boolean(min) && shiftDay(first, -1) < min : Boolean(max) && shiftMonth(first, 1) > max;
        }
        if (view === 'month') return yearOutside(curY + dir, min, max);
        return yearOutside(dir < 0 ? dec - 1 : dec + 10, min, max);
    };

    // ── Picking ──
    const pickDay = (iso: string) => { if (!dayOutside(iso, min, max)) onPick(iso); };
    const pickMonthCell = (m: number) => {
        if (mode === 'month') { onPick(`${curY}-${pad(m + 1)}`); return; }
        setCurM(m);
        setFocusIso(withMonth(focusIso, `${curY}-${pad(m + 1)}`));
        focusNext.current = true;
        setView('day');
    };
    const pickYearCell = (y: number) => {
        if (mode === 'year') { onPick(String(y)); return; }
        setCurY(y);
        focusNext.current = true;
        setView('month');
    };

    // ── Keyboard ──
    const onKeyDown = (e: React.KeyboardEvent) => {
        const t = e.target as HTMLButtonElement;
        if (view === 'day' && t.dataset?.iso) {
            const next = dayAfterKey(t.dataset.iso, e.key, e.shiftKey, weekStart);
            if (!next) return;
            e.preventDefault();
            if (dayOutside(next, min, max)) return;
            focusNext.current = true;
            showMonthOf(next);
        } else if (view !== 'day' && t.dataset?.cell !== undefined) {
            const jump = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 } as Record<string, number>)[e.key];
            if (!jump) return;
            e.preventDefault();
            const cells = [...rootRef.current!.querySelectorAll<HTMLButtonElement>('[data-cell]')];
            let i = cells.indexOf(t);
            for (;;) {
                i += jump;
                if (i < 0 || i >= cells.length) return;
                if (!cells[i].disabled) break;
            }
            cells[i].focus({ preventScroll: true });
        }
    };

    // ── What each view draws ──
    const days = view === 'day' ? monthGrid(curY, curM, weekStart) : [];
    const heldCell = view === 'month'
        ? (mode === 'month' ? (selectedMonth && parseMonth(selectedMonth)!.y === curY ? parseMonth(selectedMonth)!.m : -1) : curM)
        : -1;
    const heldYear = view === 'year' ? (mode === 'year' ? selectedYear : curY) : null;
    const tq = parseISO(today)!;

    // The cell a Tab lands on in the month / year grid: the held one, else the first usable.
    const monthCells = MONTH_SHORT.map((label, m) => ({
        m, label, off: monthOutside(`${curY}-${pad(m + 1)}`, min, max),
        held: m === heldCell, now: curY === tq.y && m === tq.m
    }));
    const yearList = yearCells(dec).map((y, i) => ({
        y, off: yearOutside(y, min, max), held: y === heldYear, now: y === tq.y, edge: i === 0 || i === 11
    }));
    const tabStopMonth = monthCells.find((c) => c.held && !c.off) || monthCells.find((c) => !c.off);
    const tabStopYear = yearList.find((c) => c.held && !c.off) || yearList.find((c) => !c.off);

    const unit = view === 'day' ? 'month' : view === 'month' ? 'year' : '10 years';

    // ── Shortcuts ──
    const defaults = dateMode
        ? [{ label: 'Today', value: today }]
        : mode === 'month' ? [{ label: 'This month', value: today.slice(0, 7) }] : [{ label: 'This year', value: today.slice(0, 4) }];
    const chips = (shortcuts ?? defaults).map((s) => ({
        ...s,
        off: dateMode ? dayOutside(s.value, min, max) : mode === 'month' ? monthOutside(s.value, min, max) : yearOutside(s.value, min, max)
    }));
    const showClear = clearable && Boolean(value);

    const titleButton = (label: React.ReactNode, aria: string, to: 'month' | 'year') => (
        <button type="button" className="cal-tbtn" aria-label={aria} onClick={() => { focusNext.current = true; setView(to); if (to === 'year') setDec(decadeStart(curY)); }}>
            {label}<ChevronDown size={14} strokeWidth={2.4} aria-hidden="true" />
        </button>
    );

    return (
        <div ref={rootRef} className={`cal-pop${big ? ' cal-big' : ''}`} onKeyDown={onKeyDown}>
            <div className="cal-head">
                <button type="button" className="cal-arrow" aria-label={`Previous ${unit}`} disabled={stepDisabled(-1)} onClick={() => step(-1)}><Chevron dir="left" /></button>
                <div className="cal-title">
                    {view === 'day' && (
                        <>
                            {titleButton(MONTH_NAMES[curM], 'Choose month', 'month')}
                            {titleButton(curY, 'Choose year', 'year')}
                        </>
                    )}
                    {view === 'month' && titleButton(curY, 'Choose year', 'year')}
                    {view === 'year' && <span className="cal-ttext" aria-live="polite">{dec} – {dec + 9}</span>}
                </div>
                <button type="button" className="cal-arrow" aria-label={`Next ${unit}`} disabled={stepDisabled(1)} onClick={() => step(1)}><Chevron dir="right" /></button>
            </div>

            <div className="cal-body">
                {view === 'day' && (
                    <>
                        <div className="cal-wd" aria-hidden="true">{weekdayLabels(weekStart).map((w) => <span key={w}>{w}</span>)}</div>
                        <div className="cal-days" role="group" aria-label={`${MONTH_NAMES[curM]} ${curY}`}>
                            {days.map((iso) => {
                                const p = parseISO(iso)!;
                                const off = dayOutside(iso, min, max);
                                const inBand = week && iso >= week.start && iso <= week.end;
                                const cls = [
                                    'cal-d',
                                    p.m !== curM ? 'out' : '',
                                    inBand ? 'band' : '',
                                    week && iso === week.start ? 'bs' : '',
                                    week && iso === week.end ? 'be' : '',
                                    iso === today && !off ? 'today' : '',
                                    !week && iso === selectedDay ? 'sel' : ''
                                ].filter(Boolean).join(' ');
                                return (
                                    <button
                                        key={iso}
                                        type="button"
                                        className={cls}
                                        data-iso={iso}
                                        tabIndex={iso === focusIso ? 0 : -1}
                                        disabled={off}
                                        aria-label={`${formatDateLong(iso)}${off ? ', not available' : ''}`}
                                        aria-pressed={iso === selectedDay}
                                        aria-current={iso === today ? 'date' : undefined}
                                        onClick={() => pickDay(iso)}
                                    >{p.d}</button>
                                );
                            })}
                        </div>
                    </>
                )}
                {view === 'month' && (
                    <div className="cal-grid3" role="group" aria-label={`Months of ${curY}`}>
                        {monthCells.map((c) => (
                            <button
                                key={c.m}
                                type="button"
                                data-cell=""
                                className={`cal-m${c.held ? ' sel' : ''}${c.now ? ' today' : ''}`}
                                tabIndex={c === tabStopMonth ? 0 : -1}
                                disabled={c.off}
                                aria-label={`${MONTH_NAMES[c.m]} ${curY}`}
                                aria-pressed={c.held}
                                onClick={() => pickMonthCell(c.m)}
                            >{c.label}</button>
                        ))}
                    </div>
                )}
                {view === 'year' && (
                    <div className="cal-grid3" role="group" aria-label={`Years ${dec} to ${dec + 9}`}>
                        {yearList.map((c) => (
                            <button
                                key={c.y}
                                type="button"
                                data-cell=""
                                className={`cal-m${c.edge ? ' out' : ''}${c.held ? ' sel' : ''}${c.now ? ' today' : ''}`}
                                tabIndex={c === tabStopYear ? 0 : -1}
                                disabled={c.off}
                                aria-pressed={c.held}
                                onClick={() => pickYearCell(c.y)}
                            >{c.y}</button>
                        ))}
                    </div>
                )}
            </div>

            {(chips.length > 0 || showClear) && (
                <div className="cal-foot">
                    {chips.map((s) => (
                        <button key={s.label} type="button" className="cal-chip" disabled={s.off} onClick={() => onPick(s.value)}>{s.label}</button>
                    ))}
                    {showClear && <button type="button" className="cal-clear" onClick={() => onClear?.()}>Clear</button>}
                </div>
            )}
        </div>
    );
}

// ── The fields ─────────────────────────────────────────────────────────────

/** A day: value "YYYY-MM-DD" (or ''), onChange("YYYY-MM-DD" or '' when cleared). */
export function DatePicker({
    id, value = '', onChange, min = '', max = '', error, status, disabled, placeholder = 'Pick a date',
    shortcuts, clearable = false, highlightWeek = false, onBlur, variant = 'field', className, triggerClassName,
    sheetTitle = 'Date', ariaLabel, formatText = formatDateText, icon, today
}: FieldProps & {
    value?: string | null; onChange?: (value: string) => void; highlightWeek?: boolean; formatText?: (iso: string) => string;
}) {
    const autoId = useId();
    const text = isValidISO(value) ? formatText((value as string).slice(0, 10)) : '';
    return (
        <PickerShell
            id={id || autoId} text={text} placeholder={placeholder} icon={icon} disabled={disabled} error={error} status={status}
            className={className} triggerClassName={triggerClassName} variant={variant} ariaLabel={ariaLabel}
            sheetTitle={sheetTitle} panelLabel="Choose a date" onBlur={onBlur}
        >
            {({ close, big }) => (
                <CalendarPanel
                    mode="date" value={value || ''} min={min} max={max} shortcuts={shortcuts} clearable={clearable}
                    highlightWeek={highlightWeek} big={big} today={today}
                    onPick={(v) => { onChange?.(v); close(); }}
                    onClear={() => { onChange?.(''); close(); }}
                />
            )}
        </PickerShell>
    );
}

/** A month: value "YYYY-MM" (or ''), onChange("YYYY-MM"). */
export function MonthPicker({
    id, value = '', onChange, min = '', max = '', error, status, disabled, placeholder = 'Pick a month',
    shortcuts, clearable = false, onBlur, variant = 'field', className, triggerClassName,
    sheetTitle = 'Month', ariaLabel, formatText = formatMonthText, icon, today
}: FieldProps & { value?: string | null; onChange?: (value: string) => void; formatText?: (ym: string) => string }) {
    const autoId = useId();
    const text = parseMonth(value) ? formatText(value as string) : '';
    return (
        <PickerShell
            id={id || autoId} text={text} placeholder={placeholder} icon={icon} disabled={disabled} error={error} status={status}
            className={className} triggerClassName={triggerClassName} variant={variant} ariaLabel={ariaLabel}
            sheetTitle={sheetTitle} panelLabel="Choose a month" onBlur={onBlur}
        >
            {({ close, big }) => (
                <CalendarPanel
                    mode="month" value={value || ''} min={min} max={max} shortcuts={shortcuts} clearable={clearable} big={big} today={today}
                    onPick={(v) => { onChange?.(v); close(); }}
                    onClear={() => { onChange?.(''); close(); }}
                />
            )}
        </PickerShell>
    );
}

/** A year: value "2026" or 2026 (or ''), onChange("2026") — a string, whatever went in. */
export function YearPicker({
    id, value = '', onChange, min = '', max = '', error, status, disabled, placeholder = 'Pick a year',
    shortcuts, clearable = false, onBlur, variant = 'field', className, triggerClassName,
    sheetTitle = 'Year', ariaLabel, formatText = String, icon, today
}: FieldProps & { value?: string | number | null; onChange?: (value: string) => void; formatText?: (year: number) => string }) {
    const autoId = useId();
    const year = parseYear(value);
    return (
        <PickerShell
            id={id || autoId} text={year ? formatText(year) : ''} placeholder={placeholder} icon={icon} disabled={disabled} error={error} status={status}
            className={className} triggerClassName={triggerClassName} variant={variant} ariaLabel={ariaLabel}
            sheetTitle={sheetTitle} panelLabel="Choose a year" onBlur={onBlur}
        >
            {({ close, big }) => (
                <CalendarPanel
                    mode="year" value={year ? String(year) : ''} min={min} max={max} shortcuts={shortcuts} clearable={clearable} big={big} today={today}
                    onPick={(v) => { onChange?.(v); close(); }}
                    onClear={() => { onChange?.(''); close(); }}
                />
            )}
        </PickerShell>
    );
}

// ── Date + time ────────────────────────────────────────────────────────────

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);
const PERIODS = ['AM', 'PM'];

function TimeColumn<T extends string | number>({ label, items, selected, format = (v: T) => v, onPick }: {
    label: string; items: T[]; selected: T; format?: (v: T) => React.ReactNode; onPick: (v: T) => void;
}) {
    const colRef = useRef<HTMLDivElement>(null);
    // Bring the chosen row into view inside its own column — scrollIntoView
    // would scroll every box around it too (body is one; see LocationPicker).
    useEffect(() => {
        const col = colRef.current;
        const row = col?.querySelector<HTMLElement>('[aria-pressed="true"]');
        if (col && row) col.scrollTop = row.offsetTop - col.clientHeight / 2 + row.clientHeight / 2;
    }, []);
    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const rows = [...colRef.current!.querySelectorAll('button')];
        const i = rows.indexOf(e.target as HTMLButtonElement);
        rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus({ preventScroll: true });
    };
    return (
        <div className="cal-time-col" role="group" aria-label={label} onKeyDown={onKeyDown}>
            <div className="cal-time-head" aria-hidden="true">{label}</div>
            <div className="cal-time-list" ref={colRef}>
                {items.map((v) => (
                    <button
                        key={v}
                        type="button"
                        className={`cal-time-item${v === selected ? ' sel' : ''}`}
                        aria-pressed={v === selected}
                        tabIndex={v === selected ? 0 : -1}
                        onClick={() => onPick(v)}
                    >{format(v)}</button>
                ))}
            </div>
        </div>
    );
}

/**
 * A day and a time of day — the visit scheduler. value / onChange are local
 * "YYYY-MM-DDTHH:mm:ss.000" strings (no zone). An empty value starts at now,
 * rounded to five minutes, as soon as it mounts.
 */
export function DateTimePicker({ id, value, onChange, error, disabled, className = '', sheetTitle = 'Start time', ariaLabel = 'Start' }: {
    id?: string; value?: string | null; onChange?: (value: string) => void; error?: unknown; disabled?: boolean;
    className?: string; sheetTitle?: string; ariaLabel?: string;
}) {
    const autoId = useId();
    const baseId = id || autoId;

    useEffect(() => {
        if (!value) onChange?.(localDateTime(roundedNow()));
    }, [value, onChange]);

    const when = readDateTime(value);
    const clock = clockParts(when);

    return (
        <div className={`cal-dt ${className}`.trim()}>
            <DatePicker
                id={`${baseId}-date`}
                className="cal-dt-date"
                value={value ? localDateTime(when).slice(0, 10) : ''}
                onChange={(iso) => iso && onChange?.(withDay(localDateTime(when), iso) as string)}
                error={error}
                disabled={disabled}
                ariaLabel={`${ariaLabel} date`}
            />
            <span className="cal-dt-at">at</span>
            <PickerShell
                id={`${baseId}-time`}
                className="cal-dt-time"
                text={value ? formatTimeText(when) : ''}
                placeholder="Pick a time"
                icon="clock"
                disabled={disabled}
                error={error}
                ariaLabel={`${ariaLabel} time`}
                sheetTitle={sheetTitle}
                panelLabel="Choose a time"
                panelWidth={240}
                panelHeight={240}
            >
                {() => (
                    <div className="cal-time">
                        <TimeColumn label="Hr" items={HOURS} selected={clock.hour}
                            onPick={(h) => onChange?.(withClock(localDateTime(when), h, clock.minute, clock.period))} />
                        <TimeColumn label="Min" items={MINUTES} selected={clock.minute} format={(m) => pad(m)}
                            onPick={(m) => onChange?.(withClock(localDateTime(when), clock.hour, m, clock.period))} />
                        <TimeColumn label="AM/PM" items={PERIODS} selected={clock.period}
                            onPick={(p) => onChange?.(withClock(localDateTime(when), clock.hour, clock.minute, p))} />
                    </div>
                )}
            </PickerShell>
        </div>
    );
}
