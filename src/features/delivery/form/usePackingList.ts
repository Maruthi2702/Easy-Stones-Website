import { useRef, useState } from 'react';
import { API_URL } from '../../../config/api';
import { authFetch } from '../../../api/authFetch';
import { planPackingListAutofill } from '../../../utils/packingListPdf';
import type { DeliveryFormValues } from '../../../utils/deliveryForm';
import type { CustomerOption } from '../../../utils/customerOptions';
import type { Loose } from '../../../types/records';

/** What an uploaded packing list filled in, and what it disagreed with. */
export type Autofill = { filled: string[]; kept: { field: string; current: string; pdf: string }[]; source: string };

type Args = {
    values: DeliveryFormValues;
    /** The latest values, for an upload that finishes after more typing. */
    latestValues: () => DeliveryFormValues;
    set: (patch: Partial<DeliveryFormValues>) => void;
    setValues: React.Dispatch<React.SetStateAction<DeliveryFormValues>>;
    customers: CustomerOption[];
};

/**
 * The Delivery form's packing list: upload (falling back to sending the PDF
 * inline), a pasted link, removing it, and filling empty fields from what the
 * upload read. DeliveryForm holds the values; this holds the upload's state.
 */
export function usePackingList({ values, latestValues, set, setValues, customers }: Args) {
    const [pdfBusy, setPdfBusy] = useState(false);
    const [pasteOpen, setPasteOpen] = useState(false);
    const [autofill, setAutofill] = useState<Autofill | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    // Fill the form's empty fields from an uploaded StoneProfits packing list
    // (packingListPdf.js). Reads the latest values, since the upload can
    // finish after someone has typed into the form.
    const applyAutofill = (parsed: Loose) => {
        const { updates, filled, kept } = planPackingListAutofill(latestValues(), parsed, customers);
        if (Object.keys(updates).length) setValues((v) => ({ ...v, ...updates }));
        const source = parsed.documentType ? parsed.documentType.toLowerCase() : 'packing list';
        setAutofill(filled.length || kept.length ? { filled, kept, source } : null);
    };

    const attachFile = async (file: File) => {
        setPdfBusy(true);
        setPasteOpen(false);
        set({ packingListFilename: file.name });
        const inline = () => new Promise<void>((resolve) => {
            // The upload route failed: send it inline instead, and the save
            // route stores it (after checking it really is a PDF).
            const reader = new FileReader();
            reader.onloadend = () => { set({ packingListUrl: reader.result as string }); resolve(); };
            reader.readAsDataURL(file);
        });
        try {
            const formData = new FormData();
            formData.append('file', file);
            const res = await authFetch(`${API_URL}/api/deliveries/upload-packing-list`, { method: 'POST', body: formData });
            if (res.ok) {
                const data = await res.json();
                set({ packingListUrl: data.url, packingListFilename: data.filename || file.name });
                if (data.packingList) applyAutofill(data.packingList);
            } else {
                await inline();
            }
        } catch {
            await inline();
        } finally {
            setPdfBusy(false);
        }
    };

    const onPasteLink = (val: string) => {
        const isUrl = val.startsWith('http://') || val.startsWith('https://');
        const name = isUrl ? (val.split('/').pop() || 'PackingList.pdf') : val;
        set({ packingListUrl: val, packingListFilename: name });
    };
    const removePdf = () => {
        set({ packingListUrl: '', packingListFilename: '' });
        setAutofill(null);
    };
    const isDataUrl = values.packingListUrl.toLowerCase().startsWith('data:application/');
    const pdfAttached = Boolean(values.packingListUrl) && (isDataUrl || !pasteOpen);

    return { pdfBusy, pasteOpen, setPasteOpen, autofill, fileRef, attachFile, onPasteLink, removePdf, isDataUrl, pdfAttached };
}

export type PackingList = ReturnType<typeof usePackingList>;
