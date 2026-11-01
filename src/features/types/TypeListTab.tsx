import { useEffect, useState } from 'react';
import { AlertCircle, ArrowUpToLine, ChevronDown, ChevronUp, Eye, EyeOff, FolderTree, GripVertical, ListOrdered, Package, Pencil, Plus, Trash2 } from 'lucide-react';
import RowMenu from '../../components/shared/RowMenu';
import type { RowMenuItem } from '../../components/shared/RowMenu';
import FormModal from '../../components/shared/form/FormModal';
import { FormField, FormPicker } from '../../components/shared/form/FormControls';
import { loadTypes, typeListApi, useTypeList } from '../../api/typeLists';
import type { TypeListKind, TypeRecord } from '../../api/typeLists';
import { moveItem } from '../../utils/typeLists';
import type { Loose } from '../../types/records';
import TypeForm from './TypeForm';
import { COPY, recordCount, typeListAccess, typeSummary } from './typeListView';
import './TypeListTab.css';

/*
 * Admin → Visit Types / Resource Types: the list the Add visit / Add resource
 * form offers, in the order managers set it. Dragging (or ↑ ↓ / To top) saves
 * at once for everyone; hiding takes a type out of the dropdown without losing
 * it on the records that have it; a type records use is deleted by moving
 * them to another. Resource Types also lists its Families underneath, managed
 * the same way with the Resource Types switches. The lists are the database's
 * (src/api/typeLists.ts).
 */

export type TypeListTabProps = {
    kind: TypeListKind;
    currentUser: Loose | null | undefined;
    sidebarToggle?: React.ReactNode;
};

export default function TypeListTab({ kind, currentUser, sidebarToggle }: TypeListTabProps) {
    return (
        <div className="tl-page">
            <div className="tl-inner">
                <TypeListSection kind={kind} currentUser={currentUser} sidebarToggle={sidebarToggle} />
                {kind === 'resource' && <TypeListSection kind="family" currentUser={currentUser} />}
            </div>
        </div>
    );
}

/** One list: the page's own (with the page title) or its Families (a section heading). */
function TypeListSection({ kind, currentUser, sidebarToggle }: TypeListTabProps) {
    const copy = COPY[kind];
    const can = typeListAccess(currentUser, kind);
    const { types, loaded, refresh } = useTypeList(kind);
    // A resource type's row names its family; a family's row counts its types.
    const related = useTypeList(kind === 'resource' ? 'family' : 'resource').types;
    const isSection = kind === 'family';
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
        run(() => typeListApi.reorder(kind, next.map((t: TypeRecord) => t._id)), 'Could not save the order');
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

    const Icon = kind === 'visit' ? ListOrdered : kind === 'family' ? FolderTree : Package;
    const Heading = isSection ? 'h2' : 'h1';

    return (
        <section className={isSection ? 'tl-section' : 'tl-main'} aria-label={copy.title}>
            <header className="tl-header">
                {sidebarToggle}
                <span className="tl-header-icon" aria-hidden="true"><Icon size={18} /></span>
                <Heading className={isSection ? 'tl-title tl-title-sub' : 'tl-title'}>{copy.title}</Heading>
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
                                <span className="tl-sub">{typeSummary(kind, t, related)}</span>
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
                    others={types.filter((t) => t.active && t._id !== deleting._id)}
                    onClose={() => setDeleting(null)}
                    onDelete={async (replaceWith) => {
                        await typeListApi.remove(kind, deleting._id, replaceWith);
                        // Its types moved family: reload them so their rows say where.
                        if (kind === 'family') await loadTypes('resource', { force: true });
                    }}
                />
            )}
        </section>
    );
}

function DeleteTypeDialog({ kind, type, others, onClose, onDelete }: {
    kind: TypeListKind; type: TypeRecord; others: TypeRecord[]; onClose: () => void; onDelete: (replaceWith?: string) => Promise<unknown>;
}) {
    const copy = COPY[kind];
    // null while the count loads; then how many records carry the type.
    const [uses, setUses] = useState<number | null>(null);
    const [replaceWith, setReplaceWith] = useState('');
    const [tried, setTried] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        let live = true;
        typeListApi.uses(kind, type._id)
            .then((n) => { if (live) setUses(n); })
            .catch((err) => { if (live) setError((err as Error).message || 'Could not check where it is used'); });
        return () => { live = false; };
    }, [kind, type._id]);

    const moving = (uses ?? 0) > 0;
    const confirm = async () => {
        if (uses === null) return;
        if (moving && !replaceWith) { setTried(true); return; }
        setSaving(true);
        setError('');
        try { await onDelete(moving ? replaceWith : undefined); onClose(); } catch (err) { setError((err as Error).message || 'Could not delete'); } finally { setSaving(false); }
    };
    return (
        <FormModal
            title={`Delete ${copy.noun}`}
            size="s"
            onClose={onClose}
            onSubmit={(e) => { e.preventDefault(); confirm(); }}
            submitLabel={moving ? 'Move and delete' : 'Delete'}
            savingLabel={moving ? 'Moving…' : 'Deleting…'}
            submitTone="danger"
            submitDisabled={uses === null || (moving && others.length === 0)}
            saving={saving}
        >
            {uses === null && !error && <p className="tl-confirm">Checking where <strong>{type.label}</strong> is used…</p>}
            {uses === 0 && (
                <p className="tl-confirm">Delete <strong>{type.label}</strong>? It disappears from the list for everyone.</p>
            )}
            {moving && (
                <>
                    <p className="tl-confirm">
                        {kind === 'family'
                            ? <><strong>{type.label}</strong> holds {recordCount(kind, uses as number)}. Choose the family they move to, then it's deleted. To keep it, hide it instead.</>
                            : <><strong>{type.label}</strong> is on {recordCount(kind, uses as number)}. Choose the type they become, then it's deleted. To keep them as they are, hide it instead.</>}
                    </p>
                    {others.length === 0 ? (
                        <p className="tl-confirm">There is no other shown {copy.noun} to move them to.</p>
                    ) : (
                        <FormField name="replaceWith" id="tl-replace" label="Move them to" required error={tried && !replaceWith ? `Choose a ${copy.noun}` : ''}>
                            <FormPicker
                                id="tl-replace"
                                value={replaceWith || null}
                                onChange={(v) => setReplaceWith(v)}
                                options={others.map((t) => ({ value: t._id, label: t.label }))}
                                error={tried && !replaceWith}
                                sheetTitle="Move them to"
                            />
                        </FormField>
                    )}
                </>
            )}
            {error && <div className="tl-error" role="alert"><AlertCircle size={14} aria-hidden="true" />{error}</div>}
        </FormModal>
    );
}
