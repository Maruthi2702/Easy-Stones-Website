/**
 * Customers ⋯ → Import sales: the SPS report "Sales by Customer - Monthly", in the
 * same three steps as Import from SPS (design: claude.ai artifact "Import Sales Flow",
 * https://claude.ai/artifact/Nvgh55Mf4aa5C9SwCDx3Pp): Upload and file check → Check
 * names → Results. The file is read here, the server checks it (POST /sales/preview,
 * writes nothing) and lists the names that match no customer with look-alikes; a person
 * picks the customer for each, or skips it. Nothing is saved until Import, which replaces
 * the year and remembers the picks. Rules: src/utils/customerSales.ts.
 */
import { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { AlertTriangle, Upload } from 'lucide-react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSearchPicker } from '../../../components/shared/form/FormControls';
import { useCustomerOptions } from '../../../api/customerOptions';
import { API_URL } from '../../../config/api';
import { authFetch } from '../../../api/authFetch';
import './SpsConnectModal.css';
import './SpsImportModal.css';

type Suggestion = { id: string; company: string; city: string };
type Unmatched = { name: string; key: string; primaryRep: string; cents: number; suggestions: Suggestion[] };
type Preview = {
    year: number; totalCents: number; customers: number; matched: number; unmatched: Unmatched[];
    earlier: { importedAt: string; customers: number } | null;
};
type Done = { year: number; customers: number; matched: number; linked: number; unmatched: string[]; totalCents: number };

const STEPS = ['Upload', 'Check names', 'Results'];
const money = (cents: number) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const dollars = (cents: number) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export default function SalesImportModal({ onClose }: { onClose: () => void }) {
    const fileInput = useRef<HTMLInputElement | null>(null);
    const { options, loading } = useCustomerOptions();
    const [step, setStep] = useState(1);
    const [file, setFile] = useState<{ name: string; rows: unknown[][]; exportedOn: string } | null>(null);
    const [preview, setPreview] = useState<Preview | null>(null);
    /** report key → customer id, or 'skip'. */
    const [picks, setPicks] = useState<Record<string, string>>({});
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState<Done | null>(null);

    const post = async (path: string, body: unknown) => {
        const res = await authFetch(`${API_URL}/api/customers/sales/${path}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out?.message || `The server refused it (HTTP ${res.status}).`);
        return out;
    };

    const choose = async (f: File | undefined) => {
        setError(''); setPreview(null); setFile(null); setPicks({});
        if (!f) return;
        setBusy(true);
        try {
            const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
            const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, raw: true });
            const meta = wb.Sheets['Metadata'] ? XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Metadata'], { header: 1 }) : [];
            const exportedOn = String((meta.find(r => String(r[0]).startsWith('Exported On')) || [])[1] || '');
            const out = await post('preview', { rows });
            setFile({ name: f.name, rows, exportedOn });
            setPreview(out);
        } catch (err) {
            setError(err instanceof Error && err.message ? err.message : 'That file couldn’t be read. Use the Excel file from SPS.');
        } finally { setBusy(false); }
    };

    const left = preview ? preview.unmatched.filter(u => !picks[u.key]).length : 0;
    const linkedCount = Object.values(picks).filter(v => v && v !== 'skip').length;

    const send = async () => {
        if (!file || !preview) return;
        setBusy(true); setError('');
        try {
            const links = Object.fromEntries(Object.entries(picks).filter(([, v]) => v && v !== 'skip'));
            setDone(await post('import', { rows: file.rows, fileName: file.name, exportedOn: file.exportedOn, links }));
            setStep(3);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'The import failed. Nothing was changed.');
        } finally { setBusy(false); }
    };

    let label = 'Continue';
    let disabled = !preview;
    let run: () => void = () => setStep(2);
    if (step === 2) { label = preview ? `Import ${preview.year}` : 'Import'; disabled = left > 0; run = send; }
    if (step === 3) { label = 'Done'; disabled = false; run = onClose; }

    return (
        <FormModal
            title={step === 3 ? 'Sales imported' : 'Import sales'}
            size="l"
            onClose={onClose}
            onSubmit={(e) => { e.preventDefault(); if (!disabled && !busy) run(); }}
            submitLabel={label}
            submitDisabled={disabled}
            saving={busy && step === 2}
            savingLabel="Importing…"
            footerNote={step === 1 ? 'Nothing is saved until you import.' : step === 2 ? `${left} left to check · nothing is saved until you import` : ''}
        >
            <div className="spsc">
                <ol className="spsi-steps" aria-label="Steps">
                    {STEPS.map((s, i) => (
                        <li key={s} className={step === i + 1 ? 'on' : step > i + 1 ? 'done' : ''} aria-current={step === i + 1 ? 'step' : undefined}>
                            {step > i + 1 ? '✓ ' : `${i + 1} `}{s}
                        </li>
                    ))}
                </ol>
                {error && <div className="spsc-banner bad" role="alert"><AlertTriangle size={14} aria-hidden="true" /> {error}</div>}

                {step === 1 && (
                    <>
                        <button type="button" className="spsc-drop" onClick={() => fileInput.current?.click()} disabled={busy}>
                            <Upload size={20} aria-hidden="true" />
                            <b>{busy ? 'Reading the file…' : file ? file.name : 'Choose the SPS sales report'}</b>
                            <span>“Sales by Customer - Monthly”, one year, Include Tax: No · .xls or .xlsx, exactly as downloaded from SPS</span>
                        </button>
                        <input ref={fileInput} type="file" accept=".xls,.xlsx" hidden aria-label="Sales report file" onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ''; }} />
                        {preview && (
                            <div className="spsi-checks">
                                <div className="sect-title">File check</div>
                                <div className="spsi-check"><span className="spsi-dot ok">✓</span><span><b>{preview.customers.toLocaleString()}</b> customers read for <b>{preview.year}</b> · {money(preview.totalCents)} in sales{file?.exportedOn ? ` · exported ${file.exportedOn.slice(0, 10)}` : ''}</span></div>
                                <div className="spsi-check"><span className="spsi-dot ok">✓</span><span>All 12 month columns found, January to December</span></div>
                                <div className="spsi-check"><span className="spsi-dot ok">✓</span><span>No customer name appears twice</span></div>
                                {preview.earlier && (
                                    <div className="spsi-check"><span className="spsi-dot warn">!</span><span>{preview.year} was imported before ({day(preview.earlier.importedAt)}). Importing again <b>replaces</b> that year’s figures.</span></div>
                                )}
                            </div>
                        )}
                    </>
                )}

                {step === 2 && preview && (
                    <>
                        <div className="spsc-tally">
                            <div className="spsc-eq">
                                <b>{preview.customers.toLocaleString()}</b> names in the report = <b>{preview.matched.toLocaleString()}</b> matched a customer
                                {' '}+ <b>{preview.unmatched.length}</b> to check
                            </div>
                            <div className="spsc-bar" aria-hidden="true">
                                <span className="s-connected" style={{ width: `${(preview.matched / Math.max(1, preview.customers)) * 100}%` }} />
                                <span className="s-auto" style={{ width: `${(preview.unmatched.length / Math.max(1, preview.customers)) * 100}%` }} />
                            </div>
                        </div>
                        {preview.unmatched.length === 0 ? (
                            <div className="spsc-banner ok">Every name in the report matches a customer. Press Import {preview.year}.</div>
                        ) : (
                            <>
                                <div className="spsc-banner info">These names aren’t any customer’s company or SPS name. Choose the customer each one is, or skip it — a skipped name is not added to any customer. Your choice is remembered for the next file.</div>
                                <div className="spsc-review">
                                    {preview.unmatched.map(u => {
                                        const pick = picks[u.key] || '';
                                        const skipped = pick === 'skip';
                                        const set = (v: string) => setPicks(p => ({ ...p, [u.key]: v }));
                                        const clear = () => setPicks(p => { const n = { ...p }; delete n[u.key]; return n; });
                                        return (
                                            <fieldset key={u.key} className="spsc-card">
                                                <legend><b>{u.name}</b><span className="spsc-muted"> · {dollars(u.cents)}{u.primaryRep ? ` · ${u.primaryRep}` : ''}</span></legend>
                                                {!skipped && (
                                                    <FormSearchPicker
                                                        id={`sales-pick-${u.key}`}
                                                        value={pick || null}
                                                        onChange={set}
                                                        options={options}
                                                        loading={loading}
                                                        placeholder="Choose the customer…"
                                                        searchPlaceholder="Search customers"
                                                        sheetTitle={`Customer for ${u.name}`}
                                                        keepInForm
                                                    />
                                                )}
                                                {!pick && u.suggestions.length > 0 && (
                                                    <div className="spsc-muted">Looks like:{' '}
                                                        {u.suggestions.map(s => (
                                                            <button key={s.id} type="button" className="spsi-link" style={{ marginRight: 10 }} onClick={() => set(s.id)}>
                                                                {s.company}{s.city ? ` · ${s.city}` : ''}
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                                {pick && !skipped && <div className="spsc-muted">✓ Sales will show on this customer, and the link is remembered.</div>}
                                                {skipped && <div className="spsc-muted">Skipped — not added to any customer.</div>}
                                                <div className="spsi-btnrow">
                                                    {skipped || pick
                                                        ? <button type="button" className="spsi-link" onClick={clear}>Change</button>
                                                        : <button type="button" className="spsi-link" onClick={() => set('skip')}>Skip this name</button>}
                                                </div>
                                            </fieldset>
                                        );
                                    })}
                                </div>
                                <div className="spsi-room" aria-hidden="true" />
                            </>
                        )}
                    </>
                )}

                {step === 3 && done && (
                    <>
                        <div className="spsi-counts">
                            <div><b>{done.customers.toLocaleString()}</b><span>customers imported</span></div>
                            <div><b>{money(done.totalCents)}</b><span>{done.year} sales</span></div>
                            <div><b>{done.linked}</b><span>names linked by you</span></div>
                            <div><b>{done.unmatched.length}</b><span>skipped</span></div>
                        </div>
                        <div className="spsc-banner ok">✓ Open any customer’s Sales Report tab to see their months.</div>
                        {done.unmatched.length > 0 && <div className="spsc-muted">Not on any profile: {done.unmatched.join(' · ')}</div>}
                    </>
                )}
                {step === 2 && linkedCount > 0 && <div className="spsc-muted" aria-live="polite">{linkedCount} name{linkedCount === 1 ? '' : 's'} linked so far.</div>}
            </div>
        </FormModal>
    );
}
