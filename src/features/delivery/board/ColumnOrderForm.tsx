import React, { useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSection } from '../../../components/shared/form/FormControls';
import { saveDeliveryColumnOrder } from '../../../api/deliverySchedule';
import { columnLabel, defaultColumnOrder, isDefaultOrder, moveItem, orderBoardColumns } from '../../../utils/deliveryColumns';
import type { BoardColumn } from '../types';
import './ColumnOrderForm.css';

/*
 * Arrange Driver Columns — someone with that permission (Users & Roles →
 * Delivery Schedule) sets the left-to-right order of one branch's delivery
 * board, from Search & filters below Location. Drag a row, or use
 * its arrows (the only way on a phone, where rows don't drag). Saving the
 * default order stores nothing, so drivers added later keep following the
 * default rule; any other order is stored on the branch for everyone.
 */
export type ColumnOrderFormProps = {
    location: string;
    /** The branch's current drivers and Will Call. */
    columns: BoardColumn[];
    savedOrder: string[] | null;
    onClose: () => void;
    onSaved?: (saved: string[]) => void;
};

export default function ColumnOrderForm({ location, columns, savedOrder, onClose, onSaved }: ColumnOrderFormProps) {
    const byId = useMemo(() => new Map(columns.map((c) => [c.id, c] as const)), [columns]);
    const initial = useMemo(() => orderBoardColumns(columns, savedOrder).map((c: BoardColumn) => c.id), [columns, savedOrder]);
    const [order, setOrder] = useState<string[]>(initial);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    const [overIndex, setOverIndex] = useState<number | null>(null);

    const changed = order.some((id, i) => id !== initial[i]);
    const atDefault = isDefaultOrder(columns, order);

    const move = (from: number, to: number) => {
        setOrder((list) => moveItem(list, from, to));
        setError('');
    };

    // An arrow press keeps focus on the row it moved, so pressing again keeps
    // moving it — and when that arrow has just run out (top or bottom), on
    // the row's other arrow rather than dropping focus off the form.
    const listRef = useRef<HTMLOListElement>(null);
    const nudge = (i: number, step: number, id: string) => {
        move(i, i + step);
        requestAnimationFrame(() => {
            const row = listRef.current?.querySelector(`[data-col="${CSS.escape(id)}"]`);
            const [up, down] = row ? [...row.querySelectorAll<HTMLButtonElement>('.dco-arrow')] : [];
            const same = step < 0 ? up : down;
            (same && !same.disabled ? same : (step < 0 ? down : up))?.focus();
        });
    };

    const submit = async () => {
        setSaving(true);
        setError('');
        try {
            const saved = await saveDeliveryColumnOrder(location, atDefault ? [] : order);
            onSaved?.(saved);
            onClose();
        } catch (err) {
            setError((err as Error).message || 'Couldn’t save the column order. Try again.');
            setSaving(false);
        }
    };

    const endDrag = () => { setDragIndex(null); setOverIndex(null); };

    const footerStart = (
        <button
            type="button"
            className="fm-btn fm-btn-small"
            disabled={saving || atDefault}
            title={atDefault ? 'Already in the default order' : 'Our drivers A–Z, then 3rd-party trucks, then Will Call'}
            onClick={() => { setOrder(defaultColumnOrder(columns).map((c: BoardColumn) => c.id)); setError(''); }}
        >
            Reset to default
        </button>
    );

    return (
        <FormModal
            title={<>Arrange Driver Columns <span className="fm-title-sub">· {location}</span></>}
            size="s"
            onClose={onClose}
            onSubmit={submit}
            submitLabel="Save order"
            saving={saving}
            submitDisabled={!changed}
            dirtyCount={changed ? 1 : 0}
            discardTitle="Discard the new order?"
            footerStart={footerStart}
            footerNote={error
                ? <span className="fm-error" role="alert"><AlertCircle size={13} aria-hidden="true" />{error}</span>
                : null}
        >
            <FormSection>
                <ol ref={listRef} className="dco-list" aria-label={`Column order for ${location}, first is leftmost`}>
                    {order.map((id, i) => {
                        const col = byId.get(id);
                        if (!col) return null;
                        const name = columnLabel(col);
                        const classes = ['dco-row'];
                        if (dragIndex === i) classes.push('is-dragging');
                        if (overIndex === i && dragIndex !== null && dragIndex !== i) {
                            classes.push(dragIndex < i ? 'is-over-below' : 'is-over-above');
                        }
                        return (
                            <li
                                key={id}
                                data-col={id}
                                className={classes.join(' ')}
                                draggable={!saving}
                                onDragStart={(e) => {
                                    setDragIndex(i);
                                    e.dataTransfer.effectAllowed = 'move';
                                    // Firefox won't start a drag without data.
                                    e.dataTransfer.setData('text/plain', id);
                                }}
                                onDragOver={(e) => {
                                    if (dragIndex === null) return;
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = 'move';
                                    if (overIndex !== i) setOverIndex(i);
                                }}
                                onDrop={(e) => {
                                    e.preventDefault();
                                    if (dragIndex !== null) move(dragIndex, i);
                                    endDrag();
                                }}
                                onDragEnd={endDrag}
                            >
                                <GripVertical size={16} className="dco-grip" aria-hidden="true" />
                                <span className="dco-pos" aria-hidden="true">{i + 1}</span>
                                <span className="dco-dot" style={{ background: col.color || '#D4AF37' }} aria-hidden="true" />
                                <span className="dco-name">{name}</span>
                                <span className="dco-arrows">
                                    <button
                                        type="button"
                                        className="dco-arrow"
                                        disabled={saving || i === 0}
                                        aria-label={`Move ${name} up, further left on the board`}
                                        title="Move up (further left)"
                                        onClick={() => nudge(i, -1, id)}
                                    >
                                        <ArrowUp size={15} aria-hidden="true" />
                                    </button>
                                    <button
                                        type="button"
                                        className="dco-arrow"
                                        disabled={saving || i === order.length - 1}
                                        aria-label={`Move ${name} down, further right on the board`}
                                        title="Move down (further right)"
                                        onClick={() => nudge(i, 1, id)}
                                    >
                                        <ArrowDown size={15} aria-hidden="true" />
                                    </button>
                                </span>
                            </li>
                        );
                    })}
                </ol>
            </FormSection>
        </FormModal>
    );
}
