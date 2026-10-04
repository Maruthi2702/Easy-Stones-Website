import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Star, X } from 'lucide-react';
import useIsPhone from '../../shared/form/useIsPhone';
import { FormSheet } from '../../shared/form/FormControls';
import { describedBy } from '../../shared/form/formFocus';
import { toggleLocation, homeAfterChange } from '../../../utils/userForm';

/**
 * Which branches someone works at, and which one is home (★ — where their
 * screens open). Tags in the field; a checkbox list opens under it on desktop
 * and as a bottom sheet on phones.
 */
export default function LocationsPicker({ id, locations, value, home, onChange, error }) {
    const isPhone = useIsPhone();
    const [open, setOpen] = useState(false);
    const wrapRef = useRef(null);
    const allOn = value.includes('*');

    const set = (list, nextHome = home) => onChange({ assignedLocations: list, location: homeAfterChange(nextHome, list) });
    const toggle = (key) => set(toggleLocation(value, key));
    const makeHome = (name) => onChange({ assignedLocations: value, location: name });

    useEffect(() => {
        if (!open || isPhone) return;
        const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [open, isPhone]);

    // Home first, then the rest in branch order.
    const picked = allOn ? [] : locations.filter((n) => value.includes(n));
    const ordered = [...picked.filter((n) => n === home), ...picked.filter((n) => n !== home)];
    const count = allOn ? locations.length : picked.length;

    const options = (
        <div className="up-loc-list">
            <button type="button" role="checkbox" aria-checked={allOn} className="fm-opt up-loc-all" onClick={() => toggle('*')}>
                <span className="fm-check"><Check size={12} strokeWidth={3.2} aria-hidden="true" /></span>
                <span className="fm-opt-label">Every location</span>
            </button>
            <div className="up-loc-divider" aria-hidden="true" />
            <ul className="up-loc-grid">
                {locations.map((name) => {
                    const on = allOn || value.includes(name);
                    const isHome = name === home;
                    return (
                        <li key={name} className="up-loc-item" data-on={on ? 'true' : undefined}>
                            <button type="button" role="checkbox" aria-checked={value.includes(name)} className="fm-opt up-loc-toggle" onClick={() => toggle(name)}>
                                <span className="fm-check" data-on={allOn ? 'true' : undefined}><Check size={12} strokeWidth={3.2} aria-hidden="true" /></span>
                                <span className="up-loc-name">{name}</span>
                            </button>
                            {on && (
                                <button
                                    type="button"
                                    className="up-star"
                                    aria-pressed={isHome}
                                    aria-label={isHome ? `${name} is home` : `Make ${name} home`}
                                    title={isHome ? 'Home' : 'Make home'}
                                    onClick={() => makeHome(name)}
                                >
                                    <Star size={16} aria-hidden="true" fill={isHome ? 'currentColor' : 'none'} />
                                </button>
                            )}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
    const countText = `${count} of ${locations.length} selected`;

    return (
        <div ref={wrapRef}>
            <div className="up-ms" data-open={open ? 'true' : undefined} data-invalid={error ? 'true' : undefined}>
                {allOn && <span className="up-tag">Every location</span>}
                {allOn && home && (
                    <span className="up-tag up-tag-home"><Star size={14} fill="currentColor" aria-hidden="true" />{home}<span className="up-tag-suffix"> · home</span></span>
                )}
                {ordered.map((name) => {
                    const isHome = name === home;
                    return (
                        <span key={name} className={`up-tag${isHome ? ' up-tag-home' : ''}`}>
                            <button
                                type="button"
                                className="up-tag-btn"
                                aria-pressed={isHome}
                                aria-label={isHome ? `${name} is home` : `Make ${name} home`}
                                onClick={() => makeHome(name)}
                            >
                                <Star size={14} fill={isHome ? 'currentColor' : 'none'} aria-hidden="true" />
                            </button>
                            {name}{isHome && <span className="up-tag-suffix"> · home</span>}
                            <button type="button" className="up-tag-btn" aria-label={`Remove ${name}`} onClick={() => set(value.filter((v) => v !== name))}>
                                <X size={13} strokeWidth={2.6} aria-hidden="true" />
                            </button>
                        </span>
                    );
                })}
                {count === 0 && <span className="fm-placeholder up-ms-empty">No locations yet</span>}
                <button
                    id={id}
                    type="button"
                    className="up-ms-toggle"
                    aria-haspopup="true"
                    aria-expanded={open}
                    onClick={() => setOpen((v) => !v)}
                    {...describedBy(id, error)}
                >
                    {count ? 'Edit' : 'Choose'}<ChevronDown size={16} aria-hidden="true" />
                </button>
            </div>
            {open && !isPhone && (
                <div className="fm-menu up-loc-menu" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } }}>
                    {options}
                    <div className="up-loc-foot">
                        <span className="fm-status">{countText}</span>
                        <button type="button" className="fm-btn fm-btn-small" onClick={() => setOpen(false)}>Done</button>
                    </div>
                </div>
            )}
            {isPhone && (
                <FormSheet open={open} title="Locations" onClose={() => setOpen(false)} footer={<span className="fm-status">{countText}</span>}>
                    {options}
                </FormSheet>
            )}
        </div>
    );
}
