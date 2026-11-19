import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { TypeFacet } from './resourceList';

/**
 * Filters → Resource type (owner, 2026-11-19): a dropdown you can tick several
 * in. The closed field says how many ("3 of 5 types"); the list opens in place
 * under it (never floating, so the Filters panel can't clip it), grouped by
 * family with a Select all / Clear per family and each type's count.
 */
export default function TypeMultiSelect({ facets, picked, onChange }: {
    facets: TypeFacet[];
    picked: string[];
    onChange: (next: string[]) => void;
}) {
    const id = useId();
    const [open, setOpen] = useState(false);
    const all = facets.flatMap((f) => f.types.map((t) => t.type));
    const on = all.filter((t) => picked.includes(t)).length;
    const summary = on === 0 ? 'All types' : on === 1 ? (facets.flatMap((f) => f.types).find((t) => picked.includes(t.type))?.label ?? '1 type') : `${on} of ${all.length} types`;

    const toggle = (type: string) => onChange(picked.includes(type) ? picked.filter((v) => v !== type) : [...picked, type]);
    const setFamily = (types: string[], tick: boolean) => onChange(
        tick ? [...picked, ...types.filter((t) => !picked.includes(t))] : picked.filter((t) => !types.includes(t))
    );

    return (
        <div className="lf-group">
            <span className="lf-group-label" id={`${id}-label`}>Resource type</span>
            <button
                type="button"
                className="fm-picker-trigger"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={`${id}-list`}
                aria-labelledby={`${id}-label ${id}-value`}
                onClick={() => setOpen((o) => !o)}
            >
                <span className="fm-opt-text"><span className="fm-opt-label" id={`${id}-value`}>{summary}</span></span>
                <ChevronDown size={18} aria-hidden="true" />
            </button>
            {open && (
                <div className="rs-types" id={`${id}-list`} role="group" aria-labelledby={`${id}-label`}>
                    {facets.map((family) => {
                        const names = family.types.map((t) => t.type);
                        const every = names.every((t) => picked.includes(t));
                        return (
                            <div key={family.family} className="rs-fgroup">
                                <div className="rs-fhead">
                                    <span className="rs-fgroup-label">{family.label}</span>
                                    <button type="button" className="rs-fall" onClick={() => setFamily(names, !every)}>
                                        {every ? 'Clear' : 'Select all'}
                                    </button>
                                </div>
                                <div className="lf-checks">
                                    {family.types.map(({ type, label, count }) => (
                                        <label key={type} className="lf-check">
                                            <input type="checkbox" checked={picked.includes(type)} onChange={() => toggle(type)} />
                                            <span className="rs-check-text">{label}</span>
                                            <span className="rs-count">{count}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
