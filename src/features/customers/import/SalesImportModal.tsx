import { useState } from 'react';
import * as XLSX from 'xlsx';
import FormModal from '../../../components/shared/form/FormModal';
import { API_URL } from '../../../config/api';
import { authFetch } from '../../../api/authFetch';
import { readSalesSheet } from '../../../utils/customerSales';

type Done = { year: number; customers: number; rows: number; matched: number; unmatched: string[]; totalCents: number };
const money = (cents: number) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/**
 * Customers ⋯ → Import sales: the SPS report "Sales by Customer - Monthly".
 * The file is read here (to show what's in it before anything is sent), the
 * server reads it again, and the year's figures are replaced. Names with no
 * customer are listed afterwards; nothing is guessed.
 */
export default function SalesImportModal({ onClose }: { onClose: () => void }) {
    const [file, setFile] = useState<{ name: string; rows: unknown[][]; exportedOn: string } | null>(null);
    const [problem, setProblem] = useState('');
    const [saving, setSaving] = useState(false);
    const [done, setDone] = useState<Done | null>(null);

    const pick = async (f: File | undefined) => {
        setProblem(''); setFile(null);
        if (!f) return;
        try {
            const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
            const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, raw: true });
            const meta = wb.Sheets['Metadata'] ? XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Metadata'], { header: 1 }) : [];
            const exportedOn = String((meta.find(r => String(r[0]).startsWith('Exported On')) || [])[1] || '');
            const sheet = readSalesSheet(rows);
            if (sheet.problems.length) { setProblem(sheet.problems[0]); return; }
            setFile({ name: f.name, rows, exportedOn });
        } catch {
            setProblem('That file couldn’t be read. Use the Excel file from SPS.');
        }
    };
    const sheet = file ? readSalesSheet(file.rows) : null;

    const send = async () => {
        if (!file) return;
        setSaving(true); setProblem('');
        try {
            const res = await authFetch(`${API_URL}/api/customers/sales/import`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rows: file.rows, fileName: file.name, exportedOn: file.exportedOn })
            });
            const body = await res.json();
            if (!res.ok) setProblem(body?.message || 'The import failed.'); else setDone(body);
        } catch {
            setProblem('The import failed. Nothing was changed.');
        } finally { setSaving(false); }
    };

    if (done) {
        return (
            <FormModal title="Sales imported" size="m" onClose={onClose} onSubmit={e => { e.preventDefault(); onClose(); }} submitLabel="Done">
                <p>{done.year}: {done.customers} customers, {money(done.totalCents)} in sales. {done.matched} matched a customer here.</p>
                {done.unmatched.length > 0 && (
                    <>
                        <p><b>{done.unmatched.length} names in the report match no customer</b> (by SPS name or company name), so they show on no profile:</p>
                        <p style={{ maxHeight: 180, overflow: 'auto' }}>{done.unmatched.join(' · ')}</p>
                    </>
                )}
            </FormModal>
        );
    }
    return (
        <FormModal title="Import sales" size="m" onClose={onClose} onSubmit={e => { e.preventDefault(); send(); }}
            submitLabel="Import" savingLabel="Importing…" saving={saving} submitDisabled={!file}>
            <p>Choose the SPS report <b>Sales by Customer - Monthly</b> (one year, Include Tax: No). Importing replaces that year’s figures.</p>
            <input type="file" accept=".xlsx,.xls" onChange={e => pick(e.target.files?.[0])} aria-label="Sales report file" />
            {problem && <p role="alert" style={{ color: 'var(--cl-danger, #b42318)' }}>{problem}</p>}
            {sheet && !problem && <p>{sheet.year}: {sheet.entries.length} customers, {money(sheet.totalCents)} in sales{file?.exportedOn ? `, exported ${file.exportedOn}` : ''}.</p>}
        </FormModal>
    );
}
