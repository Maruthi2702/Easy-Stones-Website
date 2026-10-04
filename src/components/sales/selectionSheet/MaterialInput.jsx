import React, { useId, useMemo, useState } from 'react';
import { Loader2, Scan } from 'lucide-react';

/*
 * A material box for one Selection Sheet row: type to get catalog names in
 * a list right under the box (in the flow of the form, like FormPicker — never
 * floating, so a modal can't clip or paint over it), with the tag-scan button
 * inside the box on the right.
 *
 * Keyboard: ↑/↓ move through the list, Enter picks (and never submits the
 * sheet), Esc closes the list without closing the sheet.
 */
export default function MaterialInput({
    id, value, onChange, products = [], disabled = false, ariaLabel,
    onScan, scanning = false, progress = 0, placeholder = 'Search material…'
}) {
    const listId = useId();
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(-1);
    const query = String(value || '').trim().toUpperCase();

    const suggestions = useMemo(() => {
        if (!query) return [];
        const names = [...new Set(products.map((p) => String(p?.name || '').trim()).filter(Boolean))];
        return names.filter((n) => n.toUpperCase().includes(query) && n.toUpperCase() !== query).slice(0, 8);
    }, [products, query]);
    const showList = open && !disabled && suggestions.length > 0;

    const pick = (name) => {
        onChange(name.toUpperCase());
        setOpen(false);
        setActive(-1);
    };

    const onKeyDown = (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            if (!suggestions.length) return;
            e.preventDefault();
            setOpen(true);
            const step = e.key === 'ArrowDown' ? 1 : -1;
            setActive((i) => (i + step + suggestions.length) % suggestions.length);
        } else if (e.key === 'Enter') {
            // Enter inside a material box never saves the sheet mid-typing.
            e.preventDefault();
            if (showList && active >= 0) pick(suggestions[active]);
            else setOpen(false);
        } else if (e.key === 'Escape' && showList) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
            setActive(-1);
        }
    };

    return (
        <div className="ss-mat">
            <div className="ss-mat-field">
                <input
                    id={id}
                    className="fm-input ss-mat-input no-capitalize"
                    type="text"
                    role="combobox"
                    aria-label={ariaLabel}
                    aria-autocomplete="list"
                    aria-expanded={showList}
                    aria-controls={showList ? listId : undefined}
                    aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
                    autoComplete="off"
                    spellCheck={false}
                    value={value}
                    placeholder={placeholder}
                    disabled={disabled}
                    onChange={(e) => { onChange(e.target.value.toUpperCase()); setOpen(true); setActive(-1); }}
                    onFocus={() => setOpen(true)}
                    onBlur={() => setTimeout(() => setOpen(false), 120)}
                    onKeyDown={onKeyDown}
                />
                {onScan && !disabled && (
                    scanning ? (
                        <span className="ss-scan-progress" role="status" aria-label={`Reading the tag, ${progress}%`}>
                            <Loader2 size={14} className="animate-spin" aria-hidden="true" />{progress}%
                        </span>
                    ) : (
                        <button type="button" className="ss-scan-btn" onClick={onScan} aria-label="Scan a slab tag photo" title="Scan a slab tag photo">
                            <Scan size={16} aria-hidden="true" />
                        </button>
                    )
                )}
            </div>
            {showList && (
                <ul id={listId} role="listbox" className="fm-menu ss-suggest">
                    {suggestions.map((name, i) => (
                        <li
                            key={name}
                            id={`${listId}-${i}`}
                            role="option"
                            aria-selected={i === active}
                            className="fm-opt ss-suggest-opt"
                            data-active={i === active ? 'true' : undefined}
                            onMouseDown={(e) => { e.preventDefault(); pick(name); }}
                        >
                            {name}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
