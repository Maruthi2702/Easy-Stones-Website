import { useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';
import './DashboardSearch.css';

export type DashboardSearchProps = {
    value: string;
    onChange: (value: string) => void;
    /** What it searches, for screen readers: "Search visits". */
    label: string;
    /** "2 of 17" while something is typed; nothing when empty. */
    count?: string | null;
};

/** The placeholder every dashboard tab shares (the Dashboard tabs canvas, "Search box — one for every tab"). */
export const DASHBOARD_SEARCH_PLACEHOLDER = 'Search customer, contact, note';

const typingInto = (el: EventTarget | null) => {
    const node = el as HTMLElement | null;
    if (!node) return false;
    const tag = node.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable;
};

/**
 * The one search box on every dashboard tab (owner, 2026-10-31; claude.ai artifact
 * "Dashboard tabs — Visits, Resources, Follow-ups, Calendar", board "Search box").
 * 40px tall and 300px wide on desktop and tablet, 44px and the full row on a phone
 * (16px text so iOS doesn't zoom). Empty on desktop it shows a "/" key: pressing /
 * anywhere outside a text field jumps into it. Typed, it shows how many match and
 * a ✕ to clear. Focused, a gold border and ring.
 */
export default function DashboardSearch({ value, onChange, label, count = null }: DashboardSearchProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || typingInto(e.target)) return;
            // Only the box on screen (one tab at a time is mounted).
            if (!inputRef.current || inputRef.current.offsetParent === null) return;
            e.preventDefault();
            inputRef.current.focus();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, []);
    return (
        <label className={`dsx${value ? ' has-value' : ''}`}>
            <Search className="dsx-icon" size={16} aria-hidden="true" />
            <input
                ref={inputRef}
                type="search"
                className="dsx-input no-capitalize"
                aria-label={label}
                placeholder={DASHBOARD_SEARCH_PLACEHOLDER}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape' && value) { e.preventDefault(); onChange(''); } }}
            />
            {value ? (
                <>
                    {count && <span className="dsx-count">{count}</span>}
                    <button type="button" className="dsx-clear" aria-label="Clear search" onClick={() => { onChange(''); inputRef.current?.focus(); }}>
                        <X size={13} strokeWidth={2.4} />
                    </button>
                </>
            ) : (
                <kbd className="dsx-key" aria-hidden="true">/</kbd>
            )}
        </label>
    );
}
