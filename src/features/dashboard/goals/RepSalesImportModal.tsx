import { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { AlertTriangle, Upload } from 'lucide-react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSearchPicker } from '../../../components/shared/form/FormControls';
import { useStaffList } from '../../../api/salesRepOptions';
import { importRepSales, previewRepSales } from '../../../api/salesGoals';
import type { RepSalesDone, RepSalesPreview } from '../../../api/salesGoals';
import { displayNameOf, isSalesRep } from '../../../utils/salesReps';

/**
 * Goals → Import sales: the SPS report "Sales by Primary Sales Rep - Monthly" (one row per sales
 * person, one year, Include Tax: No), uploaded as often as wanted — each upload replaces its year.
 * Three steps like Import sales on the Customers list: Upload and file check → Match names → Results.
 * The file is read here and checked by the server (nothing is written until Import). A sales person
 * who is nobody's Display Name can be matched to a staff member by hand and that pick is remembered;
 * a name left alone is simply not counted for anyone. Rules: src/utils/repSales.ts.
 */
const STEPS = ['Upload', 'Match names', 'Results'];
const money = (cents: number) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
/** More names than this are not offered a picker; the biggest come first and the rest are tiny or long gone. */
const SHOWN = 40;

export default function RepSalesImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
    const fileInput = useRef<HTMLInputElement | null>(null);
    const staff = useStaffList();
    const options = useMemo(
        () => staff.filter((u) => isSalesRep(u) && u.isActive !== false).map((u) => ({ value: String(u._id), label: displayNameOf(u), description: String(u.location || '') }))
            .sort((a, b) => a.label.localeCompare(b.label)),
        [staff]
    );
    const [step, setStep] = useState(1);
    const [file, setFile] = useState<{ name: string; rows: unknown[][]; exportedOn: string } | null>(null);
    const [preview, setPreview] = useState<RepSalesPreview | null>(null);
    /** report name key → staff id. */
    const [picks, setPicks] = useState<Record<string, string>>({});
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState<RepSalesDone | null>(null);

    const choose = async (f: File | undefined) => {
        setError(''); setPreview(null); setFile(null); setPicks({});
        if (!f) return;
        setBusy(true);
        try {
            const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
            const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, raw: true });
            const meta = wb.Sheets['Metadata'] ? XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Metadata'], { header: 1 }) : [];
            const exportedOn = String((meta.find((r) => String(r[0]).startsWith('Exported On')) || [])[1] || '');
            const out = await previewRepSales(rows);
            setFile({ name: f.name, rows, exportedOn });
            setPreview(out);
        } catch (err) {
            setError(err instanceof Error && err.message ? err.message : 'That file couldn’t be read. Use the Excel file from SPS.');
        } finally { setBusy(false); }
    };

    const send = async () => {
        if (!file || !preview) return;
        setBusy(true); setError('');
        try {
            const links = Object.fromEntries(Object.entries(picks).filter(([, v]) => v));
            setDone(await importRepSales({ rows: file.rows, fileName: file.name, exportedOn: file.exportedOn, links }));
            setStep(3);
            onDone();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'The import failed. Nothing was changed.');
        } finally { setBusy(false); }
    };

    const unmatched = preview?.unmatched ?? [];
    const pickedCount = Object.values(picks).filter(Boolean).length;
    let label = unmatched.length ? 'Continue' : preview ? `Import ${preview.year}` : 'Continue';
    let disabled = !preview;
    let run: () => void = unmatched.length ? () => setStep(2) : () => { void send(); };
    if (step === 2) { label = preview ? `Import ${preview.year}` : 'Import'; disabled = false; run = () => { void send(); }; }
    if (step === 3) { label = 'Done'; disabled = false; run = onClose; }

    return (
        <FormModal
            title={step === 3 ? 'Sales imported' : 'Import sales by rep'}
            size="l"
            onClose={onClose}
            onSubmit={(e) => { e.preventDefault(); if (!disabled && !busy) run(); }}
            submitLabel={label}
            submitDisabled={disabled}
            saving={busy && (step === 2 || (step === 1 && !unmatched.length && Boolean(preview)))}
            savingLabel="Importing…"
            footerNote={step < 3 ? 'Nothing is saved until you import.' : ''}
        >
            <div className="gl-imp">
                <ol className="gl-imp-steps" aria-label="Steps">
                    {STEPS.map((s, i) => (
                        <li key={s} className={step === i + 1 ? 'on' : step > i + 1 ? 'done' : ''} aria-current={step === i + 1 ? 'step' : undefined}>
                            {step > i + 1 ? '✓ ' : `${i + 1} `}{s}
                        </li>
                    ))}
                </ol>
                {error && <div className="gl-imp-banner is-bad" role="alert"><AlertTriangle size={14} aria-hidden="true" /> {error}</div>}

                {step === 1 && (
                    <>
                        <button type="button" className="gl-imp-drop" onClick={() => fileInput.current?.click()} disabled={busy}>
                            <Upload size={20} aria-hidden="true" />
                            <b>{busy && !preview ? 'Reading the file…' : file ? file.name : 'Choose the SPS sales-by-rep report'}</b>
                            <span>“Sales by Primary Sales Rep - Monthly”, one year, Include Tax: No · .xls or .xlsx, exactly as downloaded from SPS</span>
                        </button>
                        <input ref={fileInput} type="file" accept=".xls,.xlsx" hidden aria-label="Sales by rep file" onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = ''; }} />
                        {preview && (
                            <ul className="gl-imp-checks" aria-label="File check">
                                <li><b>{preview.reps.toLocaleString()}</b> sales people read for <b>{preview.year}</b> · {money(preview.totalCents)} in sales{file?.exportedOn ? ` · exported ${file.exportedOn.slice(0, 10)}` : ''}</li>
                                <li>All 12 month columns found, and every row adds up to its Total</li>
                                <li><b>{preview.matched.length}</b> of {preview.reps} names are a staff member’s name{unmatched.length ? ` · ${unmatched.length} to match next` : ''}</li>
                                {preview.noRepCents !== 0 && <li>{money(preview.noRepCents)} is credited to no sales person and is not counted for anyone</li>}
                                {preview.earlier && <li className="is-warn">{preview.year} was imported before ({day(preview.earlier.importedAt)}). Importing again <b>replaces</b> that year’s figures.</li>}
                            </ul>
                        )}
                    </>
                )}

                {step === 2 && preview && (
                    <>
                        <div className="gl-imp-banner">
                            These sales people aren’t any staff member’s Display Name. Pick who each one is, or leave it alone — a name you leave isn’t counted for anyone. Your pick is remembered for the next file.
                        </div>
                        <ul className="gl-imp-list">
                            {unmatched.slice(0, SHOWN).map((u) => (
                                <li key={u.key}>
                                    <span className="gl-imp-who"><b>{u.name}</b> <span>{money(u.cents)}</span></span>
                                    <FormSearchPicker
                                        id={`rep-pick-${u.key}`}
                                        value={picks[u.key] || null}
                                        onChange={(v) => setPicks((p) => ({ ...p, [u.key]: v }))}
                                        options={options}
                                        placeholder="Not counted"
                                        searchPlaceholder="Search staff"
                                        sheetTitle={`Who is ${u.name}?`}
                                        keepInForm
                                    />
                                    {picks[u.key] ? <button type="button" className="dfx-link" onClick={() => setPicks((p) => { const n = { ...p }; delete n[u.key]; return n; })}>Clear</button> : <span />}
                                </li>
                            ))}
                        </ul>
                        {unmatched.length > SHOWN && <p className="gl-note">and {unmatched.length - SHOWN} smaller names that won’t be counted.</p>}
                        {pickedCount > 0 && <p className="gl-note" aria-live="polite">{pickedCount} matched so far.</p>}
                    </>
                )}

                {step === 3 && done && (
                    <>
                        <ul className="gl-imp-checks" aria-label="Results">
                            <li><b>{done.reps.toLocaleString()}</b> sales people imported for <b>{done.year}</b> · {money(done.totalCents)} in sales</li>
                            <li><b>{done.matched}</b> counted for a staff member{done.linked ? ` (${done.linked} matched by you)` : ''}</li>
                        </ul>
                        <div className="gl-imp-banner is-ok">✓ The Goals view now compares each rep’s goals with these figures.</div>
                        {done.unmatched.length > 0 && <p className="gl-note">Not counted for anyone: {done.unmatched.slice(0, 8).map((u) => `${u.name} (${money(u.cents)})`).join(', ')}{done.unmatched.length > 8 ? ` and ${done.unmatched.length - 8} more` : ''}</p>}
                    </>
                )}
            </div>
        </FormModal>
    );
}
