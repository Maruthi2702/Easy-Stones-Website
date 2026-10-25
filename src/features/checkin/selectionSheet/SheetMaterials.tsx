import React from 'react';
import { AlertCircle, AlertTriangle, Check, Plus, Trash2, X } from 'lucide-react';
import { SHEET_ROWS, tidyPrice, formatSlabSize, type SheetRow } from '../../../utils/selectionSheet.ts';
import MaterialInput from './MaterialInput';

/** A note under a row after a tag scan: what was filled, or why it couldn't be read. */
export type RowNotice = { tone: 'ok' | 'warn' | 'error'; lines: string[] } | null;

export type SheetMaterialsProps = {
    rows: SheetRow[];
    /** The catalog (/api/products), for the material suggestions. */
    products: { name?: string }[];
    canEdit: boolean;
    isPhone: boolean;
    /** The row a tag scan is filling, and how far along it is. */
    scanning: { idx: number; progress: number } | null;
    notices: Record<number, RowNotice>;
    /** A row's price message, once its box has been left. */
    priceError: (i: number) => string;
    onRowChange: (i: number, patch: Partial<SheetRow>) => void;
    onPriceLeft: (i: number) => void;
    onRemove: (i: number) => void;
    onAdd: () => void;
    onScan: (i: number) => void;
    onDismissNotice: (i: number) => void;
};

/**
 * The Selection Sheet's materials: a table on desktop and tablets, one thin
 * card per material on phones. Moved out of SelectionSheetForm unchanged
 * (2026-10-23); the form keeps the rows and passes every change back.
 */
export default function SheetMaterials({
    rows, products, canEdit, isPhone, scanning, notices, priceError,
    onRowChange, onPriceLeft, onRemove, onAdd, onScan, onDismissNotice
}: SheetMaterialsProps) {
    const notice = (i: number) => {
        const n = notices[i];
        if (!n) return null;
        return (
            <div className={`ss-notice ss-notice-${n.tone}`} role="status">
                {n.tone === 'ok' ? <Check size={13} aria-hidden="true" /> : <AlertTriangle size={13} aria-hidden="true" />}
                <div className="ss-notice-text">{n.lines.map((l) => <div key={l}>{l}</div>)}</div>
                <button type="button" className="ss-notice-close" aria-label="Dismiss" onClick={() => onDismissNotice(i)}>
                    <X size={12} aria-hidden="true" />
                </button>
            </div>
        );
    };

    const materialBox = (row: SheetRow, i: number) => (
        <MaterialInput
            id={`ss-mat-${i}`}
            value={row.material}
            onChange={(material) => onRowChange(i, { material })}
            products={products}
            disabled={!canEdit}
            ariaLabel={`Material, item ${i + 1}`}
            onScan={canEdit ? () => onScan(i) : undefined}
            scanning={scanning?.idx === i}
            progress={scanning?.idx === i ? scanning.progress : 0}
        />
    );
    // No example text in these boxes (2026-10-10): the same "13845 · 1, 2 ·
    // 126 × 63 · $0.00" on every row read as real data nobody had entered.
    // The column headings (cards: the labels) say what goes where.
    const smallInput = (row: SheetRow, i: number, key: 'lot' | 'details' | 'size', label: string, inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']) => (
        <input
            id={`ss-${key}-${i}`}
            className="fm-input no-capitalize"
            type="text"
            inputMode={inputMode}
            aria-label={`${label}, item ${i + 1}`}
            value={row[key]}
            disabled={!canEdit}
            onChange={(e) => onRowChange(i, { [key]: e.target.value })}
            // Size: "142 79", "142x79", a pasted "142" x 79"" → "142 * 79"
            // once you leave the box (formatSlabSize) — not while typing.
            onBlur={key === 'size' ? (e) => {
                const tidy = formatSlabSize(e.target.value);
                if (tidy !== row.size) onRowChange(i, { size: tidy });
            } : undefined}
        />
    );
    const priceInput = (row: SheetRow, i: number) => {
        const err = priceError(i);
        return (
            <span className="ss-price-cell">
                <span className="ss-price">
                    <span className="ss-price-sign" aria-hidden="true">$</span>
                    <input
                        id={`ss-price-${i}`}
                        className="fm-input no-capitalize ss-price-input"
                        type="text"
                        inputMode="decimal"
                        aria-label={`Price per square foot, item ${i + 1}`}
                        aria-invalid={err ? 'true' : undefined}
                        aria-describedby={err ? `ss-price-${i}-msg` : undefined}
                        value={row.price}
                        disabled={!canEdit}
                        onChange={(e) => onRowChange(i, { price: e.target.value })}
                        onBlur={(e) => {
                            onPriceLeft(i);
                            const tidy = tidyPrice(e.target.value);
                            if (tidy !== row.price) onRowChange(i, { price: tidy });
                        }}
                    />
                </span>
                {err && <span className="fm-error" id={`ss-price-${i}-msg`}><AlertCircle size={13} aria-hidden="true" />{err}</span>}
            </span>
        );
    };
    const removeButton = (i: number) => (canEdit && rows.length > 1 ? (
        <button
            type="button"
            className="ss-remove"
            onClick={() => onRemove(i)}
            disabled={scanning != null}
            aria-label={`Remove item ${i + 1}`}
            title={scanning != null ? 'Wait for the tag scan to finish' : 'Remove this item'}
        >
            {isPhone ? <X size={15} aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}
        </button>
    ) : <span className="ss-remove-spacer" aria-hidden="true" />);

    return (
        <>
        {!isPhone ? (
            <div className="ss-table">
                <div className="ss-row ss-row-head" aria-hidden="true">
                    <span>#</span><span>Material</span>
                    <span className="ss-trio"><span>Lot #</span><span>Slabs</span><span>Size</span><span>Price / SF</span></span>
                    <span />
                </div>
                {rows.map((row, i) => (
                    <div className="ss-row" key={i}>
                        <span className="ss-row-num">{i + 1}</span>
                        <div className="ss-row-mat">{materialBox(row, i)}{notice(i)}</div>
                        <div className="ss-trio">
                            {smallInput(row, i, 'lot', 'Lot or bundle number', 'numeric')}
                            {smallInput(row, i, 'details', 'Slab numbers')}
                            {smallInput(row, i, 'size', 'Size')}
                            {priceInput(row, i)}
                        </div>
                        {removeButton(i)}
                    </div>
                ))}
                {canEdit && rows.length < SHEET_ROWS && (
                    <button type="button" className="fm-btn fm-btn-small ss-add-row" onClick={onAdd}>
                        <Plus size={16} aria-hidden="true" />Add material row
                    </button>
                )}
            </div>
        ) : (
            <div className="ss-cards">
                {rows.map((row, i) => (
                    <div className="ss-card" key={i}>
                        <div className="ss-card-top">
                            <span className="ss-card-num" aria-hidden="true">{i + 1}</span>
                            {materialBox(row, i)}
                            {removeButton(i)}
                        </div>
                        {notice(i)}
                        <div className="ss-card-trio">
                            <label className="ss-card-field"><span>Lot #</span>{smallInput(row, i, 'lot', 'Lot or bundle number', 'numeric')}</label>
                            <label className="ss-card-field"><span>Slabs</span>{smallInput(row, i, 'details', 'Slab numbers')}</label>
                            <label className="ss-card-field"><span>Size</span>{smallInput(row, i, 'size', 'Size')}</label>
                            <label className="ss-card-field"><span>Price / SF</span>{priceInput(row, i)}</label>
                        </div>
                    </div>
                ))}
                {canEdit && rows.length < SHEET_ROWS && (
                    <button type="button" className="ss-add-card" onClick={onAdd}>+ Add Another Item</button>
                )}
            </div>
        )}
        </>
    );
}
