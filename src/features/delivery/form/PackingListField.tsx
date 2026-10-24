import { AlertTriangle, FileText, Upload, X } from 'lucide-react';
import { FormField } from '../../../components/shared/form/FormControls';
import { openPdfInline } from '../../../utils/packingList';
import type { DeliveryFormValues } from '../../../utils/deliveryForm';
import type { Loose } from '../../../types/records';
import type { PackingList } from './usePackingList';

export type PackingListFieldProps = {
    values: DeliveryFormValues;
    /** The saved ticket: its signed copy opens while its packing list is unchanged. */
    initialData: Loose | null;
    packing: PackingList;
};

/** The Delivery form's Packing list field: attach, paste a link, view, remove, and what it filled in. */
export default function PackingListField({ values, initialData, packing }: PackingListFieldProps) {
    const { pdfBusy, pasteOpen, setPasteOpen, autofill, fileRef, attachFile, onPasteLink, removePdf, isDataUrl, pdfAttached } = packing;
    return (
        <FormField name="packingList" id="df-packingList" label="Packing list">
            <input ref={fileRef} type="file" accept=".pdf,application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) attachFile(f); }} />
            {pdfBusy ? (
                <div className="df-drop" role="status"><span className="fm-spinner" aria-hidden="true" /><span className="df-drop-text">Attaching PDF…</span></div>
            ) : pdfAttached ? (
                <div className="df-file">
                    <FileText size={20} aria-hidden="true" />
                    <span className="df-file-text">
                        <b>{values.packingListFilename || 'Packing list.pdf'}</b>
                        <span className="df-file-ok">Attached</span>
                    </span>
                    {/* The signed copy only while this is still the packing list it was
                        signed on; a newly attached file opens itself. */}
                    <button
                        type="button"
                        className="fm-btn fm-btn-small"
                        onClick={() => openPdfInline(initialData?.pod?.signedPdfUrl && values.packingListUrl === initialData?.packingListUrl
                            ? initialData.pod.signedPdfUrl
                            : values.packingListUrl)}
                    >
                        View
                    </button>
                    <button type="button" className="df-icon-btn" aria-label="Remove packing list" title="Remove" onClick={removePdf}>
                        <X size={16} aria-hidden="true" />
                    </button>
                </div>
            ) : (
                <>
                    <div className="df-drop">
                        <FileText size={20} aria-hidden="true" />
                        <span className="df-drop-text">No PDF attached</span>
                        <button type="button" id="df-packingList" className="fm-btn fm-btn-small" onClick={() => fileRef.current?.click()}>
                            <Upload size={15} aria-hidden="true" />Choose PDF
                        </button>
                        <button type="button" className="df-link" aria-expanded={pasteOpen} onClick={() => setPasteOpen((o) => !o)}>Paste a link</button>
                    </div>
                    {pasteOpen && (
                        <input
                            className="fm-input no-capitalize"
                            type="url"
                            aria-label="Link to the packing list PDF"
                            placeholder="https://"
                            value={isDataUrl ? '' : values.packingListUrl}
                            onChange={(e) => onPasteLink(e.target.value)}
                        />
                    )}
                </>
            )}
            {autofill && values.packingListUrl && (
                <div className="df-autofill" role="status">
                    {autofill.filled.length > 0 && (
                        <span className="df-autofill-ok">Filled in from the {autofill.source}: {autofill.filled.join(', ')}. Check them before saving.</span>
                    )}
                    {autofill.kept.map((k) => (
                        <span key={k.field} className="df-autofill-kept">
                            <AlertTriangle size={12} aria-hidden="true" />
                            {k.field} left as “{k.current}” — the {autofill.source} says “{k.pdf}”.
                        </span>
                    ))}
                </div>
            )}
        </FormField>
    );
}
