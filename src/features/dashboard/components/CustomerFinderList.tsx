import { AlertCircle, Plus, SearchX } from 'lucide-react';
import { highlightParts, initialsOf, rowDetail } from '../../../utils/customerQuickSearch';
import type { CustomerOption } from '../../../utils/customerOptions';
import type { CustomerFinder } from './useCustomerFinder';

// The square behind a customer's initials: one of a few muted colours, fixed per customer.
const AVATAR_COLOURS = ['#8a6d1d', '#2f6f5e', '#3d5a8a', '#7a3e5c', '#5b5f2a', '#6a4b8a'];
const avatarColour = (id: string) => {
    let n = 0;
    for (const ch of id) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
    return AVATAR_COLOURS[n % AVATAR_COLOURS.length];
};

function Marked({ text, query }: { text: string; query: string }) {
    return <>{highlightParts(text, query).map((part, i) => (part.hit ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>))}</>;
}

/**
 * Find a customer's list — the same in the pop-up and under the header field:
 * recently opened or the matches, loading, couldn't load, and no match (with
 * Add customer when `onAddCustomer` is given).
 */
export default function CustomerFinderList({ finder, onAddCustomer, className = 'dcs-body' }: {
    finder: CustomerFinder;
    onAddCustomer?: (name: string) => void;
    className?: string;
}) {
    const { typed, rows, found, recent, active, setActive, pick, listRef, listId, loading, failed, refresh } = finder;

    const renderRow = (customer: CustomerOption, index: number) => {
        const detail = rowDetail(customer);
        const id = String(customer.value);
        return (
            <div
                key={id}
                id={`${listId}-${index}`}
                data-row={index}
                role="option"
                aria-selected={index === active}
                className={`dcs-row${index === active ? ' is-active' : ''}`}
                onMouseMove={() => { if (index !== active) setActive(index); }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(customer)}
            >
                <span className="dcs-avatar" style={{ background: avatarColour(id) }} aria-hidden="true">{initialsOf(customer.label) || '?'}</span>
                <span className="dcs-main">
                    <span className="dcs-name"><Marked text={customer.label} query={typed} /></span>
                    {detail && <span className="dcs-sub"><Marked text={detail} query={typed} /></span>}
                </span>
                {customer.customerType && <span className="dcs-type">{customer.customerType}</span>}
                {customer.salesRepName && <span className="dcs-rep" title={`Rep: ${customer.salesRepName}`}>{initialsOf(customer.salesRepName)}</span>}
                <span className="dcs-enter" aria-hidden="true">Open ↵</span>
            </div>
        );
    };

    let body: React.ReactNode;
    if (failed) {
        body = (
            <div className="dcs-empty">
                <AlertCircle size={28} aria-hidden="true" />
                <strong>Couldn’t load the customer list</strong>
                <p>Check your connection, then try again.</p>
                <button type="button" className="dcs-gold-btn" onClick={() => { void refresh(); }}>Try again</button>
            </div>
        );
    } else if (loading) {
        body = (
            <>
                <div className="dcs-group">Loading customers…</div>
                {[46, 38, 52].map((w) => (
                    <div className="dcs-skeleton" key={w} aria-hidden="true"><i /><i style={{ width: `${w}%` }} /></div>
                ))}
            </>
        );
    } else if (typed && !found.total) {
        body = (
            <div className="dcs-empty">
                <SearchX size={28} aria-hidden="true" />
                <strong>No customer matches “{typed}”</strong>
                <p>Check the spelling, or search by the contact’s name or city.</p>
                {onAddCustomer && (
                    <button type="button" className="dcs-gold-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => onAddCustomer(typed)}>
                        <Plus size={15} aria-hidden="true" /> Add customer “{typed}”
                    </button>
                )}
            </div>
        );
    } else if (!typed && !recent.length) {
        body = <div className="dcs-hint">Type a customer’s name, contact or city.</div>;
    } else {
        body = (
            <>
                <div className="dcs-group">
                    {typed ? 'Customers' : 'Recently opened'}
                    {typed && <em>{found.total} found</em>}
                </div>
                {rows.map(renderRow)}
                {typed && found.total > rows.length && (
                    <div className="dcs-more">Keep typing to narrow it down · {found.total - rows.length} more</div>
                )}
            </>
        );
    }

    return (
        <div className={className} ref={listRef} id={listId} role="listbox" aria-label="Customers">
            {body}
        </div>
    );
}
