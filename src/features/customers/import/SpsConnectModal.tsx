/**
 * Connect existing customers to SPS — the one-time step before the new SPS
 * import (build step 3 of the "SPS Import Redesign" artifact).
 *
 * Three stages in one window: pick the SPS file → a dry-run report (nothing
 * written; how many connect by exact name, how many need a person) → the
 * review of the rest, saved as you go. Every call re-posts the file; the server
 * re-plans against the database each time (src/routes/customerSpsConnect.ts).
 */
import { useRef, useState } from 'react';
import { Upload, Check } from 'lucide-react';
import FormModal from '../../../components/shared/form/FormModal';
import SpsSide from './SpsSide';
import { placeOf } from './spsImport';
import { API_URL } from '../../../config/api';
import { authFetch } from '../../../api/authFetch';
import type { Loose } from '../../../types/records';
import './SpsConnectModal.css';
import './SpsImportModal.css';

const fail = async (res: Response): Promise<string> => {
    const text = await res.text();
    let said = '';
    try { const j = JSON.parse(text); said = j.message || j.error || ''; } catch { /* not JSON */ }
    return `${said || text.slice(0, 200) || res.statusText} (HTTP ${res.status})`;
};
const n = (v: unknown) => Number(v).toLocaleString();
const SIGNAL_WORDS: Record<string, string> = { phone: 'same phone', email: 'same email', 'company name': 'similar name', 'email domain': 'same email domain' };

/** The dry-run report from POST /api/customers/sps-connect/preview. */
type ConnectReport = Loose & {
    total: number; connected: number; notInSps: number; autoCount: number; spsRows: number; spsUnclaimed: number;
    autoSample: Loose[]; toCheck: Loose[];
};
export type SpsConnectModalProps = { onClose?: () => void; onChanged?: () => void };

export default function SpsConnectModal({ onClose, onChanged }: SpsConnectModalProps) {
    const fileInput = useRef<HTMLInputElement | null>(null);
    const [file, setFile] = useState<File | null>(null);
    const [report, setReport] = useState<ConnectReport | null>(null);   // the preview
    const [stage, setStage] = useState('upload'); // upload | report | review | done
    const [answers, setAnswers] = useState<Record<string, string>>({});   // customerId → spsKey | 'none' | 'later'
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');

    const post = async (path: string, fields: Record<string, unknown> = {}) => {
        const body = new FormData();
        body.append('file', file as File);
        for (const [k, v] of Object.entries(fields)) body.append(k, typeof v === 'string' ? v : JSON.stringify(v));
        const res = await authFetch(`${API_URL}/api/customers/sps-connect/${path}`, { method: 'POST', body });
        if (!res.ok) throw new Error(await fail(res));
        return res.json();
    };
    const run = async (fn: () => Promise<void>) => {
        setBusy(true); setError('');
        try { await fn(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
    };

    const check = () => run(async () => {
        const data = await post('preview');
        setReport(data);
        setAnswers({});
        setStage(data.autoCount === 0 && data.toCheck.length > 0 ? 'review' : (data.autoCount === 0 ? 'done' : 'report'));
    });

    const connectExact = () => run(async () => {
        const done = await post('apply', { connectAuto: 'true' });
        onChanged?.();
        setNotice(`${n(done.connected)} customers connected to SPS.${done.failed.length ? ` ${done.failed.length} couldn’t be saved.` : ''}`);
        const data = await post('preview');
        setReport(data);
        setStage(data.toCheck.length ? 'review' : 'done');
    });

    const answered = Object.entries(answers).filter(([, a]) => a && a !== 'later');
    const saveAnswers = () => run(async () => {
        const done = await post('apply', { answers });
        onChanged?.();
        setNotice(`${n(done.connected)} connected, ${n(done.notInSps)} marked not in SPS.${done.failed.length + done.rejected.length ? ` ${done.failed.length + done.rejected.length} not saved — see below.` : ''}`);
        const data = await post('preview');
        setReport(data);
        setAnswers({});
        setStage(data.toCheck.length ? 'review' : 'done');
    });

    let submit: { label?: string; onSubmit?: () => void; disabled?: boolean } = {};
    if (stage === 'upload') submit = { label: 'Check the file', onSubmit: check, disabled: !file };
    else if (stage === 'report') submit = { label: `Connect ${n(report!.autoCount)} customers`, onSubmit: connectExact, disabled: false };
    else if (stage === 'review') submit = { label: answered.length ? `Save ${n(answered.length)} answer${answered.length === 1 ? '' : 's'}` : 'Save answers', onSubmit: saveAnswers, disabled: answered.length === 0 };
    else submit = { label: 'Done', onSubmit: () => onClose?.(), disabled: false };

    const left = report ? report.toCheck.length : 0;
    const bar: [string, number][] = report && report.total > 0 ? [
        ['connected', report.connected], ['notin', report.notInSps],
        ['auto', stage === 'report' ? report.autoCount : 0],
        ['check', report.toCheck.length]
    ] : [];

    return (
        <FormModal
            title="Connect your customers to SPS"
            size="l"
            onClose={onClose}
            onSubmit={submit.onSubmit}
            submitLabel={submit.label}
            submitDisabled={submit.disabled}
            saving={busy}
            savingLabel="Working…"
            hideSubmit={stage === 'done'}
            footerNote={stage === 'review' ? `${n(left)} left to check · saved as you go` : 'Nothing is saved until you press the button.'}
        >
            <div className="spsc">
                {error && <div className="spsc-banner bad" role="alert">{error}</div>}
                {notice && <div className="spsc-banner ok" role="status"><Check size={14} aria-hidden="true" /> {notice}</div>}

                {stage === 'upload' && (
                    <>
                        <p className="spsc-muted">Pick the SPS customer export. Each customer in Easy Stones learns which SPS customer it is, so the new import can match by name instead of guessing. Exact names connect on their own; you check the rest.</p>
                        <button type="button" className="spsc-drop" onClick={() => fileInput.current?.click()}>
                            <Upload size={20} aria-hidden="true" />
                            <b>{file ? file.name : 'Choose the SPS customer export'}</b>
                            <span>.xls or .xlsx, exactly as downloaded from SPS</span>
                        </button>
                        <input ref={fileInput} type="file" accept=".xls,.xlsx" hidden onChange={(e) => setFile(e.target.files?.[0] || null)} />
                    </>
                )}

                {report && stage !== 'upload' && (
                    <div className="spsc-tally">
                        <div className="spsc-eq">
                            <b>{n(report.total)}</b> customers in Easy Stones =
                            {' '}<b>{n(report.connected)}</b> connected
                            {stage === 'report' && <> + <b>{n(report.autoCount)}</b> to connect by exact name</>}
                            {report.notInSps > 0 && <> + <b>{n(report.notInSps)}</b> not in SPS</>}
                            {' '}+ <b>{n(report.toCheck.length)}</b> to check
                        </div>
                        <div className="spsc-bar" aria-hidden="true">
                            {bar.map(([k, v]) => <span key={k} className={`s-${k}`} style={{ width: `${(v / report.total) * 100}%` }} />)}
                        </div>
                        <div className="spsc-muted">{n(report.spsRows)} customers read from the file · {n(report.spsUnclaimed)} of them aren’t any customer here yet.</div>
                    </div>
                )}

                {stage === 'report' && (
                    <>
                        <div className="spsc-banner info">This is a dry run — nothing has been saved. These customers’ company name is exactly an SPS name, so they connect without being asked. A few examples:</div>
                        <ul className="spsc-list">
                            {report!.autoSample.map((a) => <li key={a.customerId}><b>{a.company}</b>{a.company !== a.spsName && <span className="spsc-muted"> = {a.spsName}</span>}</li>)}
                        </ul>
                        {report!.autoCount > report!.autoSample.length && <div className="spsc-muted">and {n(report!.autoCount - report!.autoSample.length)} more.</div>}
                    </>
                )}

                {stage === 'review' && (
                    <div className="spsc-review">
                        {report!.toCheck.map((c) => {
                            const value = answers[c.customerId] || 'later';
                            const set = (v: string) => setAnswers((a) => ({ ...a, [c.customerId]: v }));
                            return (
                                <fieldset key={c.customerId} className="spsc-card">
                                    <legend><b>{c.company}</b>{c.location && <span className="spsc-muted"> · {c.location}</span>}</legend>
                                    {c.twin && <div className="spsc-muted">Another customer here has this same name, so it wasn’t connected unasked.</div>}
                                    <div className="spsi-compare">
                                        <SpsSide k="In Easy Stones" company={c.company} contact={c.contactName} phone={c.phone} email={c.email}
                                            street={c.street} place={placeOf(c.city, c.state, c.zipCode)} branch={c.location} rep={c.salesRepName} />
                                        {c.candidates.map((s: Loose) => (
                                            <SpsSide key={s.key} k="In SPS" company={s.name} contact={s.contactName} phone={s.phone} email={s.email}
                                                street={s.street} place={placeOf(s.city, s.state, s.zipCode)} branch={s.branch} rep={s.rep} />
                                        ))}
                                    </div>
                                    {c.candidates.map((s: Loose) => (
                                        <label key={s.key} className={`spsc-opt${value === s.key ? ' on' : ''}`}>
                                            <input type="radio" name={`c-${c.customerId}`} checked={value === s.key} onChange={() => set(s.key)} />
                                            <span><b>Same customer — connect to “{s.name}”</b>
                                                <span className="spsc-muted"> {s.signals.map((x: string) => SIGNAL_WORDS[x] || x).join(' · ')}</span>
                                            </span>
                                        </label>
                                    ))}
                                    <label className={`spsc-opt${value === 'none' ? ' on' : ''}`}>
                                        <input type="radio" name={`c-${c.customerId}`} checked={value === 'none'} onChange={() => set('none')} />
                                        <span><b>Different customer / not in SPS</b><span className="spsc-muted"> none of the above is this customer; it stays as it is and the SPS ones are added as new by the import</span></span>
                                    </label>
                                    <label className={`spsc-opt${value === 'later' ? ' on' : ''}`}>
                                        <input type="radio" name={`c-${c.customerId}`} checked={value === 'later'} onChange={() => set('later')} />
                                        <span><b>Skip for now</b><span className="spsc-muted"> decide later</span></span>
                                    </label>
                                </fieldset>
                            );
                        })}
                    </div>
                )}

                {stage === 'done' && (
                    <div className="spsc-banner ok"><Check size={14} aria-hidden="true" /> Every customer is either connected to SPS or marked as not in SPS.</div>
                )}
            </div>
        </FormModal>
    );
}
