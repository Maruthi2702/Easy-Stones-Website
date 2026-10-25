/**
 * Import customers from SPS — the five-step import from the "SPS Import
 * Redesign" artifact: Upload → Columns & names → Review → Import → Results,
 * plus Import history. The server does the work (src/routes/customerSpsImport.js):
 * it saves the file and every answer as a draft run, plans from that file,
 * writes in the background and checks the result; this window only asks and
 * shows. Every answer is saved as you go, so closing it loses nothing.
 *
 * The state and calls are useSpsImport; each step is its own file in sps/.
 */
import { useRef } from 'react';
import { AlertTriangle, Download } from 'lucide-react';
import FormModal from '../../../components/shared/form/FormModal';
import type { Loose } from '../../../types/records';
import { STEPS } from './spsImport';
import { useSpsImport } from './useSpsImport';
import SpsImportHistory from './SpsImportHistory';
import UploadStep from './sps/UploadStep';
import NamesStep from './sps/NamesStep';
import ReviewStep from './sps/ReviewStep';
import { ImportingStep, ResultsStep } from './sps/RunSteps';
import './SpsConnectModal.css';
import './SpsImportModal.css';

export type SpsImportModalProps = {
    onClose?: () => void;
    onChanged?: () => void;
    salesReps?: Loose[];
    locations?: (string | { name?: string })[];
    user?: { id?: string; _id?: string } | null;
    canEdit?: boolean;
    canAdd?: boolean;
    canDelete?: boolean;
};

function StepList({ step }: { step: number }) {
    return (
        <ol className="spsi-steps" aria-label="Steps">
            {STEPS.map((s, i) => (
                <li key={s} className={step === i + 1 ? 'on' : step > i + 1 ? 'done' : ''} aria-current={step === i + 1 ? 'step' : undefined}>
                    {step > i + 1 ? '✓ ' : `${i + 1} `}{s}
                </li>
            ))}
        </ol>
    );
}

export default function SpsImportModal({ onClose, onChanged, salesReps = [], locations = [], user = null, canEdit = false, canAdd = false, canDelete = false }: SpsImportModalProps) {
    const fileInput = useRef<HTMLInputElement | null>(null);
    const s = useSpsImport({ onChanged, salesReps, locations, canEdit, canAdd });
    const { view, step, data, error, busy, planning, progress, submit } = s;

    if (view === 'history') return <SpsImportHistory s={s} canDelete={canDelete} onClose={onClose} />;

    return (
        <FormModal
            title="Import customers from SPS"
            size="l"
            onClose={onClose}
            onSubmit={submit.run}
            submitLabel={submit.label}
            submitDisabled={submit.disabled}
            hideSubmit={submit.hide}
            saving={busy && step === 3}
            savingLabel="Starting…"
            footerNote={s.footerNote}
            footerStart={step === 3 && data ? <button type="button" className="spsi-link" onClick={s.planCsv}><Download size={14} aria-hidden="true" /> Download plan (CSV)</button> : null}
        >
            <div className="spsc">
                <StepList step={step} />
                {error && <div className="spsc-banner bad" role="alert"><AlertTriangle size={14} aria-hidden="true" /> {error}</div>}

                {view === 'loading' && <div className="spsc-muted">Loading…</div>}
                {view === 'wizard' && step === 1 && <UploadStep s={s} fileInput={fileInput} />}
                {view === 'wizard' && step === 2 && data && <NamesStep s={s} user={user} />}
                {view === 'wizard' && step === 3 && data && <ReviewStep s={s} />}
                {view === 'wizard' && step === 4 && <ImportingStep progress={progress} />}
                {view === 'wizard' && step === 5 && progress && <ResultsStep s={s} canDelete={canDelete} onClose={onClose} />}

                {planning && step !== 1 && <div className="spsc-muted" aria-live="polite">Saving your answer…</div>}
            </div>
        </FormModal>
    );
}
