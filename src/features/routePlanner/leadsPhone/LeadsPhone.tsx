import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronLeft, Clock, MapPin, Navigation, Phone, Plus, RefreshCw, Search, X } from 'lucide-react';
import { leadLine, leadsHeading, milesText, SEARCH_STEPS, typeText } from './leadsPhoneRules';
import type { NumberedLead } from './leadsPhoneRules';
import type { LeadsPhoneState } from './useLeadsPhone';
import './LeadsPhone.css';

export type LeadsPhoneProps = {
    phone: LeadsPhoneState;
    query: string;
    onQueryChange: (value: string) => void;
    recent: string[];
    onRemoveRecent: (term: string) => void;
    searching: boolean;
    saving: boolean;
    canSave: boolean;
    /** What the last failed search said, if it did. */
    error: string;
};

const SUGGESTIONS = ['stone fabricator', 'kitchen remodel', 'tile store'];

const telOf = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;
const directionsOf = (row: NumberedLead) =>
    `https://www.google.com/maps/dir/?api=1&destination=${row.lead.coordinates.lat},${row.lead.coordinates.lng}`;

const SaveButton = ({ row, phone, saving }: { row: NumberedLead; phone: LeadsPhoneState; saving: boolean }) => {
    if (phone.savedIds.has(row.lead.placeId)) {
        return <span className="lp-saved"><Check size={16} aria-hidden="true" />Saved</span>;
    }
    return (
        <button type="button" className="lp-act lp-act--add" aria-label={`Save ${row.lead.name} as a lead`} disabled={saving} onClick={() => { void phone.save(row.lead); }}>
            <Plus size={20} aria-hidden="true" />
        </button>
    );
};

/**
 * The phone's Find new leads, drawn over the map: a search bar at the top (so the keyboard
 * can never cover it), recent searches while it has focus, and a bottom sheet for what
 * was found — a list, one lead's card, or a plain message when the map is too wide, nothing
 * matched or the search failed. Only mounted by the Route Planner under 720px.
 */
const LeadsPhone = ({ phone, query, onQueryChange, recent, onRemoveRecent, searching, saving, canSave, error }: LeadsPhoneProps) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const [focused, setFocused] = useState(true);
    const drag = useRef<number | null>(null);
    const dragged = useRef(false);

    useEffect(() => { inputRef.current?.focus({ preventScroll: true }); }, []);

    const { phase, results, selected, expanded } = phone;
    const typing = phase === 'typing';

    const submit = () => {
        inputRef.current?.blur();
        void phone.run();
    };
    // A first tap on ✕ empties the box while you are still typing; otherwise it closes the search.
    const clears = typing && query.length > 0;
    const onX = () => {
        if (clears) { onQueryChange(''); inputRef.current?.focus({ preventScroll: true }); } else phone.close();
    };
    const pickRecent = (term: string) => { inputRef.current?.blur(); void phone.run(term); };

    const needle = query.trim().toLowerCase();
    const shownRecent = recent.filter((t) => !needle || t.toLowerCase().includes(needle));
    // Words to try after nothing matched: what was searched before, then the usual ones, never the same word.
    const tryInstead = [...new Set([...recent, ...SUGGESTIONS])].filter((t) => t.toLowerCase() !== query.trim().toLowerCase()).slice(0, 3);

    const pill = (() => {
        if (focused) return null;
        if ((phase === 'results' || phase === 'empty') && !selected && !expanded && phone.moved) return 'search';
        return null;
    })();

    const onHandleDown = (e: React.PointerEvent<HTMLButtonElement>) => {
        drag.current = e.clientY;
        dragged.current = false;
        e.currentTarget.setPointerCapture?.(e.pointerId);
    };
    const onHandleUp = (e: React.PointerEvent<HTMLButtonElement>) => {
        if (drag.current === null) return;
        const dy = e.clientY - drag.current;
        drag.current = null;
        if (dy <= -30) { dragged.current = true; phone.setExpanded(true); } else if (dy >= 30) { dragged.current = true; phone.setExpanded(false); }
    };
    const onHandleClick = () => {
        if (dragged.current) { dragged.current = false; return; }
        phone.setExpanded(!expanded);
    };
    const handle = (
        <button
            type="button" className="lp-handle" aria-label={expanded ? 'Show the map' : 'Show all leads'} aria-expanded={expanded}
            onPointerDown={onHandleDown} onPointerUp={onHandleUp} onClick={onHandleClick}
        ><span /></button>
    );

    const listSheet = (
        <>
            {handle}
            <div className="lp-head"><b>{leadsHeading(results.length)}</b><span>{query.trim()} · {phone.areaText}</span></div>
            <ul className="lp-list" style={{ overflowY: expanded ? 'auto' : 'hidden' }}>
                {results.map((row) => (
                    <li key={row.lead.placeId} className="lp-row">
                        <button type="button" className="lp-row-main" onClick={() => phone.selectLead(row.lead.placeId)}>
                            <span className="lp-num">{row.n}</span>
                            <span className="lp-nm"><b>{row.lead.name}</b><span>{leadLine(row)}</span></span>
                        </button>
                        {row.lead.phone && (
                            <a className="lp-act" href={telOf(row.lead.phone)} aria-label={`Call ${row.lead.name}`}><Phone size={18} aria-hidden="true" /></a>
                        )}
                        {canSave && <SaveButton row={row} phone={phone} saving={saving} />}
                    </li>
                ))}
                {phone.nextStep && (
                    <li className="lp-wider">
                        <button type="button" onClick={phone.wider}>Not finding enough? Search wider · {phone.nextStep} mi</button>
                    </li>
                )}
            </ul>
        </>
    );

    const cardSheet = selected && (
        <div className="lp-card">
            <div className="lp-handle lp-handle--still"><span /></div>
            <button type="button" className="lp-back" onClick={phone.backToList}><ChevronLeft size={20} aria-hidden="true" />{leadsHeading(results.length)}</button>
            <h2>{selected.lead.name}</h2>
            <div className="lp-tags">
                {typeText(selected.lead) && <span>{typeText(selected.lead)}</span>}
                {selected.lead.addressParts?.city && <span>{[selected.lead.addressParts.city, selected.lead.addressParts.state].filter(Boolean).join(', ')}</span>}
                <span>{milesText(selected.miles)} away</span>
            </div>
            <div className="lp-info">
                {selected.lead.address && <div><MapPin size={18} aria-hidden="true" /><span>{selected.lead.address}</span></div>}
                {selected.lead.phone && <div><Phone size={18} aria-hidden="true" /><span>{selected.lead.phone}</span></div>}
            </div>
            <div className="lp-two">
                {selected.lead.phone && <a className="lp-btn" href={telOf(selected.lead.phone)}><Phone size={18} aria-hidden="true" />Call</a>}
                <a className="lp-btn" href={directionsOf(selected)} target="_blank" rel="noopener noreferrer"><Navigation size={18} aria-hidden="true" />Directions</a>
            </div>
            {canSave && (phone.savedIds.has(selected.lead.placeId)
                ? <div className="lp-btn lp-btn--done"><Check size={18} aria-hidden="true" />Saved as a New Lead</div>
                : <button type="button" className="lp-btn lp-btn--gold" disabled={saving} onClick={() => { void phone.save(selected.lead); }}><Plus size={18} aria-hidden="true" />{saving ? 'Saving…' : 'Save as lead'}</button>)}
        </div>
    );

    const message = (icon: React.ReactNode, tone: 'gold' | 'grey', title: string, body: string, extra: React.ReactNode) => (
        <div className="lp-msg">
            <div className="lp-handle lp-handle--still"><span /></div>
            <div className={`lp-msg-ic lp-msg-ic--${tone}`}>{icon}</div>
            <h2>{title}</h2>
            <p>{body}</p>
            {extra}
        </div>
    );

    let sheet: React.ReactNode = null;
    let sheetClass = 'lp-sheet';
    if (!focused || phase !== 'typing') {
        if (phase === 'results') {
            sheet = selected ? cardSheet : listSheet;
            if (!selected) sheetClass += expanded ? ' is-full' : ' is-peek';
        } else if (phase === 'empty') {
            sheet = message(<Search size={24} aria-hidden="true" />, 'grey', `No “${query.trim()}” found here`, phone.nextStep ? 'Nothing matched in this part of the map. Try another word, or search a wider area.' : 'Nothing matched in this part of the map, and a search doesn’t go wider than this. Try another word, or move the map.', (
                <>
                    <div className="lp-lab">Try instead</div>
                    <div className="lp-chips">{tryInstead.map((t) => <button key={t} type="button" className="lp-chip" onClick={() => phone.run(t)}>{t}</button>)}</div>
                    {phone.nextStep && <button type="button" className="lp-btn lp-btn--gold" onClick={phone.wider}>Search wider · {phone.nextStep} mi</button>}
                </>
            ));
        } else if (phase === 'error') {
            sheet = message(<RefreshCw size={22} aria-hidden="true" />, 'grey', 'Couldn’t search this area', error || 'Check your connection and try again.', (
                <button type="button" className="lp-btn lp-btn--gold" onClick={() => phone.run()}>Try again</button>
            ));
        }
    }

    return createPortal(
        <div className="lp" data-testid="leads-phone">
            <div className="lp-bar">
                <Search size={20} className="lp-bar-ic" aria-hidden="true" />
                <input
                    ref={inputRef}
                    type="text"
                    className="lp-input no-capitalize"
                    placeholder="Find new leads (e.g. countertops)"
                    value={query}
                    enterKeyHint="search"
                    autoComplete="off"
                    aria-label="Search for new leads by business type"
                    onChange={(e) => onQueryChange(e.target.value)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
                />
                {searching && <span className="lp-spin" role="status" aria-label="Searching" />}
                <button type="button" className="lp-x" aria-label={clears ? 'Clear the search' : 'Close lead search'} onClick={onX}><X size={20} aria-hidden="true" /></button>
            </div>

            {focused && (
                <div className="lp-panel" onMouseDown={(e) => e.preventDefault()}>
                    <div className="lp-scope">
                        <MapPin size={18} aria-hidden="true" />
                        <span>{phone.capped ? <>Searching <b>{SEARCH_STEPS[0]} mi around the map centre</b></> : <>Searching <b>the map area on screen</b></>}</span>
                    </div>
                    {shownRecent.length > 0 && <div className="lp-lab">Recent</div>}
                    {shownRecent.map((term) => (
                        <div key={term} className="lp-rec">
                            <button type="button" className="lp-rec-term" onClick={() => pickRecent(term)}><Clock size={18} aria-hidden="true" />{term}</button>
                            <button type="button" className="lp-rec-x" aria-label={`Remove “${term}” from recent searches`} onClick={() => onRemoveRecent(term)}><X size={16} aria-hidden="true" /></button>
                        </div>
                    ))}
                </div>
            )}

            {pill === 'search' && <button type="button" className="lp-pill" onClick={() => phone.run()}><RefreshCw size={18} aria-hidden="true" />Search this area</button>}

            {sheet && <div className={sheetClass} role="region" aria-label="Lead search results">{sheet}</div>}
        </div>,
        document.body
    );
};

export default LeadsPhone;
