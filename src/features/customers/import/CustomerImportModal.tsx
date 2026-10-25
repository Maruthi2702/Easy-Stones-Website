/**
 * Import customers from a spreadsheet — shown what will happen before it does.
 *
 * The flow is deliberately two-step. The old import wrote the moment a file was
 * picked and reported a count afterwards, which meant a mis-read column was
 * discovered only in the data. Here the server plans the import and returns it;
 * nothing is written until the admin has seen the column mapping it guessed,
 * told it who the sheet's unfamiliar names are, and read the list of rows it
 * cannot safely decide alone.
 *
 * The file is re-posted for the apply rather than the plan being sent back. The
 * server re-plans against the database as it stands at that moment, so nothing
 * edited in the browser can choose which record gets written.
 *
 * The state and calls are excel/useExcelImport (the duplicates in the database:
 * excel/useDbDuplicates); the preview, its rows, the result and the duplicates
 * are their own files in excel/.
 */
import { X, Upload, AlertTriangle, Loader } from 'lucide-react';
import { useExcelImport } from './excel/useExcelImport';
import ImportPlan from './excel/ImportPlan';
import ImportRows from './excel/ImportRows';
import ImportResult from './excel/ImportResult';
import DbDuplicates, { DupResultBanner } from './excel/DbDuplicates';
import './CustomerImportModal.css';

export type CustomerImportModalProps = {
    show?: boolean;
    onClose: () => void;
    onImported?: () => void;
    /** The "already in the database" duplicates section merges and deletes records, so it needs Edit (manage_customers), not just Import. */
    canResolveDuplicates?: boolean;
};

const CustomerImportModal = ({ show, onClose, onImported, canResolveDuplicates = false }: CustomerImportModalProps) => {
    const x = useExcelImport({ onClose, onImported });
    const { file, plan, busy, error, result, fileRef, close } = x;

    if (!show) return null;

    const counts = plan?.counts;
    const working = busy === 'preview';

    return (
        <div className="import-modal-overlay" onClick={close}>
            <div className="import-modal" onClick={e => e.stopPropagation()}>
                <div className="import-modal-header">
                    <h2>Import customers from Excel</h2>
                    <button className="import-close" onClick={close}><X size={20} /></button>
                </div>

                <div className="import-modal-body">
                    {!file && (
                        <div className="import-dropzone" onClick={() => fileRef.current?.click()}>
                            <Upload size={32} />
                            <p>Choose your SPS export (.xlsx or .xls)</p>
                            <span>Nothing is saved until you have reviewed what it will do.</span>
                        </div>
                    )}
                    <input
                        ref={fileRef} type="file" accept=".xlsx,.xls"
                        style={{ display: 'none' }} onChange={x.onPickFile}
                    />

                    {error && <div className="import-error"><AlertTriangle size={16} /> {error}</div>}

                    {file && (
                        <div className="import-filebar">
                            <strong>{file.name}</strong>
                            {working && <span className="import-working"><Loader size={14} className="spin" /> reading…</span>}
                            <button className="import-link" onClick={() => fileRef.current?.click()}>Choose a different file</button>
                        </div>
                    )}

                    {plan && !result && (
                        <>
                            <ImportPlan x={x} />
                            <ImportRows x={x} />
                        </>
                    )}

                    {result && <ImportResult x={x} />}

                    <DupResultBanner dups={x.dups} />

                    {canResolveDuplicates && plan?.dbDuplicates?.length > 0 && <DbDuplicates groups={plan!.dbDuplicates} dups={x.dups} />}
                </div>

                <div className="import-modal-footer">
                    <button className="import-btn-secondary" onClick={close}>
                        {result ? 'Done' : 'Cancel'}
                    </button>
                    {plan && !result && (
                        <button
                            className="import-btn-primary"
                            onClick={x.apply}
                            disabled={busy !== '' || !plan.fileCheck.ok || (counts.create + counts.update) === 0}
                        >
                            {busy === 'apply'
                                ? <><Loader size={16} className="spin" /> Importing…</>
                                : <>Import {counts.create + counts.update} row{counts.create + counts.update === 1 ? '' : 's'}</>}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CustomerImportModal;
