/** SPS import step 2: the columns matched, and the sales reps and branches the file names that we don't recognise. */
import type React from 'react';
import { Check } from 'lucide-react';
import RepPicker from '../../../../components/shared/form/RepPicker';
import LocationPicker from '../../../../components/shared/form/LocationPicker';
import type { Loose } from '../../../../types/records';
import { FIELD_LABELS, DEFAULT_BRANCH } from '../importFields';
import { n } from '../spsImport';
import type { SpsImport } from '../useSpsImport';

/**
 * A picker opens its list inside the window's scrolling body, so on a short
 * screen a row near the bottom gets a list only a few lines tall. Bring the
 * row to the top of the body first (the body has room below it — .spsi-asks)
 * and the list gets all the space there is. Runs on click (capture), which is
 * after the press — scrolling on mouse-down moves the trigger from under the
 * pointer and the click never lands — and before the picker measures its space.
 * Scrolls the body only, never the page (scrollIntoView would — see LocationPicker).
 */
const liftRow = (e: React.MouseEvent<HTMLElement>) => {
    const row = e.currentTarget;
    const body = row.closest('.fm-body');
    if (!body) return;
    const delta = row.getBoundingClientRect().top - body.getBoundingClientRect().top - 8;
    if (Math.abs(delta) > 4) body.scrollTop += delta;
};

export default function NamesStep({ s, user }: { s: SpsImport; user?: { id?: string; _id?: string } | null }) {
    const data = s.data!;
    const { draft, planning, showMapping, setShowMapping, unanswered, repOptions, branchNames, answer } = s;
    return (
        <>
            <div className="spsc-banner ok">
                <Check size={14} aria-hidden="true" />
                <span><b>{Object.keys(data.mapping || {}).length} of {Object.keys(FIELD_LABELS).length} columns matched</b>{' '}
                    Detected from the headings. <button type="button" className="spsi-link" onClick={() => setShowMapping((v) => !v)}>{showMapping ? 'Hide' : 'Show all'}</button></span>
            </div>
            {showMapping && (
                <div className="spsi-map">
                    {Object.keys(FIELD_LABELS).map((f) => (
                        <label key={f} className="spsi-map-row">
                            <span>{FIELD_LABELS[f]}</span>
                            <select value={data.mapping?.[f] ?? ''} disabled={planning} onChange={(e) => {
                                const m = { ...(data.mapping || {}) };
                                if (e.target.value) m[f] = e.target.value; else delete m[f];
                                s.replan(s.run!.id, { mapping: m });
                            }}>
                                <option value="">— not imported —</option>
                                {data.headers.map((h: string) => <option key={h} value={h}>{h}</option>)}
                            </select>
                        </label>
                    ))}
                </div>
            )}
            {data.unresolvedReps.length > 0 && (
                <div className="spsi-asks">
                    <div className="sect-title">{data.unresolvedReps.length} sales {data.unresolvedReps.length === 1 ? 'person' : 'people'} we don’t recognise</div>
                    {data.unresolvedReps.map((u: Loose) => {
                        const suggestion = (data.reps || []).find((r: Loose) => r.name === u.suggestion);
                        return (
                            <div key={u.given} className="spsi-ask" onClickCapture={liftRow}>
                                <div><b>{u.given}</b><div className="spsc-muted">{n(u.rowCount)} customer{u.rowCount === 1 ? '' : 's'}{suggestion ? ` · suggested: ${suggestion.name}` : ''}</div></div>
                                <RepPicker id={`rep-${u.given}`} value={draft.repAliases[u.given] || ''} onChange={(v) => answer('repAliases', u.given, v)} options={repOptions}
                                    placeholder={suggestion ? `Use ${suggestion.name}?` : 'Choose a rep or “No sales rep”'} you={user?.id || user?._id} error={draft.repAliases[u.given] ? '' : ' '} />
                            </div>
                        );
                    })}
                </div>
            )}
            {data.unresolvedBranches.length > 0 && (
                <div className="spsi-asks">
                    <div className="sect-title">{data.unresolvedBranches.length} branch{data.unresolvedBranches.length === 1 ? '' : 'es'} we don’t recognise</div>
                    {data.unresolvedBranches.map((u: Loose) => (
                        <div key={u.given} className="spsi-ask" onClickCapture={liftRow}>
                            <div><b>{u.given}</b><div className="spsc-muted">{n(u.rowCount)} customer{u.rowCount === 1 ? '' : 's'}</div></div>
                            <LocationPicker id={`br-${u.given}`} value={draft.branchAliases[u.given] || ''} onChange={(v) => answer('branchAliases', u.given, v)} options={branchNames}
                                labelOf={(b) => (b === DEFAULT_BRANCH ? 'Use the default branch' : b)} user={user} placeholder="Choose a branch" error={draft.branchAliases[u.given] ? '' : ' '} />
                        </div>
                    ))}
                </div>
            )}
            {unanswered === 0
                ? <div className="spsc-muted">Every name is recognised. Continue to review.</div>
                : <div className="spsi-room" aria-hidden="true" />}
        </>
    );
}
