/**
 * One side of a "same customer?" comparison — SPS and Easy Stones laid out the
 * same way, field by field, so the two read straight across. Used by the SPS
 * import's "Need a decision" cards and by Connect customers to SPS.
 */
import React from 'react';
import './SpsImportModal.css';

const placeholder = (v) => (v && v !== 'N/A' ? v : null);

export default function SpsSide({ k, company, contact, phone, email, street, place, branch, rep }) {
    const rows = [
        ['Contact', placeholder(contact)],
        ['Phone', placeholder(phone)],
        ['Email', placeholder(email)],
        ['Address', placeholder(street)],
        ['City / State / ZIP', place],
        ['Branch', placeholder(branch)],
        ['Sales rep', placeholder(rep)]
    ];
    return (
        <div className="spsi-side">
            <span className="k">{k}</span>
            <b>{company}</b>
            {rows.map(([label, value]) => (
                <span key={label}><span className="spsc-muted">{label}: </span>{value || <span className="spsc-muted">—</span>}</span>
            ))}
        </div>
    );
}

/** "Seattle, WA 98101" from the parts that exist. */
export const placeOf = (city, state, zip) => [city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
