import { useEffect, useState } from 'react';
import { AlertCircle, ArrowUpToLine, ChevronDown, ChevronUp, Eye, EyeOff, GripVertical, ListOrdered, Package, Pencil, Plus, Trash2 } from 'lucide-react';
import RowMenu from '../../components/shared/RowMenu';
import type { RowMenuItem } from '../../components/shared/RowMenu';
import FormModal from '../../components/shared/form/FormModal';
import { typeListApi, useTypeList } from '../../api/typeLists';
import type { TypeListKind, TypeRecord } from '../../api/typeLists';
import { moveItem } from '../../utils/typeLists';
import TypeForm from './TypeForm';
import { COPY, typeListAccess, typeSummary } from './typeListView';
import './TypeListTab.css';

/*
 * Admin → Visit Types / Resource Types: the list the Add visit / Add resource
 * form offers, in the order managers set it. Dragging (or ↑ ↓ / To top) saves
 * at once for everyone; hiding takes a type out of the dropdown without losing
 * it on the records that have it; delete is only for a type nothing uses.
 * The list is the database's (src/api/typeLists.ts).
 */

export type TypeListTabProps = {
    kind: TypeListKind;
    currentUser: unknown;
    sidebarToggle?: React.ReactNode;
};

export default function TypeListTab({ kind, currentUser, sidebarToggle }: TypeListTabProps) {
    const copy = COPY[kind];
    const can = typeListAccess(currentUser, kind);
    const { types, loaded, refresh } = useTypeList(kind);
    const [form, setForm] = useState<{ type: TypeRecord | null } | null>(null);
    const [deleting, setDeleting] = useState<TypeRecord | null>(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [dragFrom, setDragFrom] = useState<number | null>(null);
    const [dragOver, setDragOver] = useState<number | null>(null);

    // Another manager may have changed it since this tab last loaded.
    useEffect(() => { refresh(); }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps

    const run = async (work: () => Promise<unknown>, fallback: string) => {
        setError('');
        setBusy(true);
        try { await work(); } catch (err) { setError((err as Error).message || fallback); } finally { setBusy(false); }
    };

    const moveTo = (from: number, to: number) => {
        if (!can.reorder || busy || from === to) return;
        const next = moveItem(types, from, to);
        if (next === types) return;
        run(() => typeListApi.reorder(kind, next.map((t) => t._id)), 'Could not save the order');
    };

    const menuFor = (t: TypeRecord): RowMenuItem[] => {
        const items: RowMenuItem[] = [];
        if (can.edit) {
            items.push({ key: 'edit', label: 'Edit', icon: Pencil, onClick: () => setForm({ type: t }) });
            items.push({
                key: 'active',
                label: t.active ? 'Hide from the list' : 'Show in the list',
                icon: t.active ? EyeOff : Eye,
                onClick: () => run(() => typeListApi.update(kind, t._id, { active: !t.active }), 'Could not save')
            });
        }
        if (can.delete && !t.system) {
            items.push({ key: 'delete', label: 'Delete…', icon: Trash2, danger: true, divider: true, onClick: () => setDeleting(t) });
        }
        return items;
    };

    const Icon = kind === 'visit' ? ListOrdered : Package;

    return (
        <div className="tl-page">
            <div className="tl-inner">
                <header className="tl-header">
                    {sidebarToggle}
                    <span className="tl-header-icon" aria-hidden="true"><Icon size={18} /></span>
                    <h1 className="tl-title">{copy.title}</h1>
                    {can.add && (
                        <button type="button" className="tl-btn tl-btn-primary" onClick={() => setForm({ type: null })}>
                            <Plus size={16} aria-hidden="true" /> Add
                        </button>
                    )}
                </header>

                <p className="tl-hint">
                    {can.reorder ? 'Drag to reorder, or use the arrows. ' : ''}
                    This is the order everyone sees in {copy.where}, so put the ones used most at the top.
                </p>

                {error && <div className="tl-error" role="alert"><AlertCircle size={14} aria-hidden="true" />{error}</div>}

                {!loaded ? (
                    <div className="tl-empty">Loading…</div>
                ) : types.length === 0 ? (
                    <div className="tl-empty">No {copy.nouns} yet.{can.add ? ' Use Add to create the first.' : ''}</div>
                ) : (
                    <ol className="tl-list" aria-label={copy.title}>
                        {types.map((t, index) => (
                            <li
                                key={t._id}
                                className={`tl-row${t.active ? '' : ' is-hidden'}${dragOver === index && dragFrom !== null && dragFrom !== index ? ' is-over' : ''}${dragFrom === index ? ' is-dragging' : ''}`}
                                draggable={can.reorder && !busy}
                                onDragStart={(e) => { setDragFrom(index); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t._id); }}
                                onDragOver={(e) => { if (dragFrom === null) return; e.preventDefault(); setDragOver(index); }}
                                onDrop={(e) => { e.preventDefault(); if (dragFrom !== null) moveTo(dragFrom, index); setDragFrom(null); setDragOver(null); }}
                                onDragEnd={() => { setDragFrom(null); setDragOver(null); }}
                            >
                                {can.reorder && <span className="tl-grip" aria-hidden="true"><GripVertical size={18} /></span>}
                                <span className="tl-num" aria-hidden="true">{index + 1}</span>
                                <span className="tl-text">
                                    <span className="tl-name">
                                        {t.label}
                                        {t.system && <span className="tl-badge">Built in</span>}
                                        {!t.active && <span className="tl-badge tl-badge-off">Hidden</span>}
                                    </span>
                                    <span className="tl-sub">{typeSummary(kind, t)}</span>
                                </span>
                                {can.reorder && (
                                    <span className="tl-moves">
                                        <button type="button" className="tl-icon" onClick={() => moveTo(index, 0)} disabled={busy || index === 0} aria-label={`Move ${t.label} to the top`} title="Move to top"><ArrowUpToLine size={16} /></button>
                                        <button type="button" className="tl-icon" onClick={() => moveTo(index, index - 1)} disabled={busy || index === 0} aria-label={`Move ${t.label} up`} title="Move up"><ChevronUp size={18} /></button>
                                        <button type="button" className="tl-icon" onClick={() => moveTo(index, index + 1)} disabled={busy || index === types.length - 1} aria-label={`Move ${t.label} down`} title="Move down"><ChevronDown size={18} /></button>
                                    </span>
                                )}
                                {menuFor(t).length > 0 && <RowMenu label={`${t.label} actions`} items={menuFor(t)} />}
                            </li>
                        ))}
                    </ol>
                )}
            </div>

            {form && (
                <TypeForm
                    kind={kind}
                    type={form.type}
                    onClose={() => setForm(null)}
                    onSave={(input) => (form.type ? typeListApi.update(kind, form.type._id, input) : typeListApi.add(kind, input))}
                />
            )}

            {deleting && (
                <DeleteTypeDialog
                    kind={kind}
                    type={deleting}
                    onClose={() => setDeleting(null)}
                    onDelete={() => typeListApi.remove(kind, deleting._id)}
                />
            )}
        </div>
    );
}

function DeleteTypeDialog({ kind, type, onClose, onDelete }: { kind: TypeListKind; type: TypeRecord; onClose: () => void; onDelete: () => Promise<unknown> }) {
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const confirm = async () => {
        setSaving(true);
        setError('');
        try { await onDelete(); onClose(); } catch (err) { setError((err as Error).message || 'Could not delete'); } finally { setSaving(false); }
    };
    return (
        <FormModal
            title={`Delete ${COPY[kind].noun}`}
            size="s"
            onClose={onClose}
            onSubmit={(e) => { e.preventDefault(); confirm(); }}
            submitLabel="Delete"
            savingLabel="Deleting…"
            submitTone="danger"
            saving={saving}
        >
            <p className="tl-confirm">Delete <strong>{type.label}</strong>? It disappears from the list for everyone. If any record uses it, hiding it is the way to remove it instead.</p>
            {error && <div className="tl-error" role="alert"><AlertCircle size={14} aria-hidden="true" />{error}</div>}
        </FormModal>
    );
}
