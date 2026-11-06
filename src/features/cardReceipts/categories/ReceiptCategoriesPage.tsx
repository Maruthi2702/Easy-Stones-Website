import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, GripVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSection, FormField, FormPicker } from '../../../components/shared/form/FormControls';
import RowMenu from '../../../components/shared/RowMenu';
import type { RowMenuItem } from '../../../components/shared/RowMenu';
import { CARD_RECEIPTS, NO_FIELDS, can, cleanCategory, type CategoryFields } from '../../../utils/cardReceipts';
import * as api from '../cardReceiptsApi';
import type { Category, ReceiptsUser } from '../types';
import '../CardReceipts.css';

const ASKS: { key: keyof CategoryFields; label: string; long: string }[] = [
  { key: 'customer', label: 'Customer', long: 'Customer (from the customer list)' },
  { key: 'attendees', label: 'Who attended', long: 'Who attended' },
  { key: 'purpose', label: 'Business purpose', long: 'Business purpose' },
  { key: 'recurring', label: 'Can be recurring', long: 'Can be marked recurring' }
];

function CategoryForm({ category, all, onSave, onClose }: {
  category: Category | null; all: Category[]; onSave: (v: { label: string; fields: CategoryFields }) => Promise<unknown>; onClose: () => void;
}) {
  const [label, setLabel] = useState(category?.label || '');
  const [fields, setFields] = useState<CategoryFields>(category?.fields || NO_FIELDS);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const problems = cleanCategory({ label, fields }, all, category?._id).problems;
  const dirty = (label !== (category?.label || '') ? 1 : 0) + ASKS.filter((a) => fields[a.key] !== (category?.fields || NO_FIELDS)[a.key]).length;
  return (
    <FormModal
      title={category ? <>Edit category <span className="fm-title-sub">· {category.label}</span></> : 'Add category'}
      size="s"
      onClose={onClose}
      onSubmit={async () => {
        setSubmitted(true);
        if (problems.label) return;
        setSaving(true);
        try { await onSave({ label: label.trim(), fields }); } catch (e) { setError((e as Error).message); setSaving(false); }
      }}
      submitLabel={category ? 'Save changes' : 'Add category'}
      saving={saving}
      submitDisabled={Boolean(category) && !dirty}
      dirtyCount={dirty}
      errors={submitted ? problems : {}}
      showErrors={submitted}
      fieldLabels={{ label: 'Name' }}
    >
      {error ? <div className="ccr-form-error" role="alert">{error}</div> : null}
      <FormSection>
        <FormField name="label" id="ccr-cat-name" label="Name" required error={submitted ? problems.label : ''}>
          <input id="ccr-cat-name" className="fm-input" maxLength={60} autoComplete="off" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Customer Lunch" />
        </FormField>
        <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'grid', gap: 10 }}>
          <legend className="fm-label" style={{ marginBottom: 8 }}>When a receipt uses it, also ask for</legend>
          {ASKS.map((a) => (
            <label key={a.key} className="ccr-check">
              <input type="checkbox" checked={fields[a.key]} onChange={(e) => setFields((f) => ({ ...f, [a.key]: e.target.checked }))} /> {a.long}
            </label>
          ))}
        </fieldset>
      </FormSection>
    </FormModal>
  );
}

function DeleteCategoryForm({ category, all, uses, onDelete, onClose }: {
  category: Category; all: Category[]; uses: number; onDelete: (replaceWith?: string) => Promise<unknown>; onClose: () => void;
}) {
  const [to, setTo] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const targets = all.filter((c) => c._id !== category._id && c.active);
  return (
    <FormModal
      title={`Delete ${category.label}?`}
      size="s"
      onClose={onClose}
      onSubmit={async () => {
        if (uses && !to) { setError('Choose where its expenses go.'); return; }
        setSaving(true);
        try { await onDelete(uses ? to : undefined); } catch (e) { setError((e as Error).message); setSaving(false); }
      }}
      submitLabel="Delete category"
      submitTone="danger"
      saving={saving}
    >
      {error ? <div className="ccr-form-error" role="alert">{error}</div> : null}
      <FormSection>
        {uses ? (
          <>
            <p style={{ margin: 0 }}>{uses} {uses === 1 ? 'expense uses' : 'expenses use'} it. They move to the category you choose, then it’s deleted.</p>
            <FormField name="to" id="ccr-cat-to" label="Move them to" required>
              <FormPicker id="ccr-cat-to" value={to} onChange={setTo} options={targets.map((c) => ({ value: c._id, label: c.label }))} placeholder="Choose a category" sheetTitle="Move them to" keepInForm />
            </FormField>
          </>
        ) : <p style={{ margin: 0 }}>No expense uses it.</p>}
      </FormSection>
    </FormModal>
  );
}

/**
 * Admin → Receipt Categories: the list staff pick from when they save a card
 * receipt, in this order. Add, rename, choose what a category also asks for,
 * hide / show, reorder (drag, or Move up / down in ⋯; saves on drop) and
 * delete — a category in use is deleted only by moving its expenses first.
 * Each action is its own switch on the Users & Roles card.
 */
export default function ReceiptCategoriesPage({ currentUser, sidebarToggle = null }: { currentUser: ReceiptsUser | null; sidebarToggle?: ReactNode }) {
  const [list, setList] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [open, setOpen] = useState<{ kind: 'add' } | { kind: 'edit'; category: Category } | { kind: 'delete'; category: Category; uses: number } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const allow = {
    add: can(currentUser, CARD_RECEIPTS.CATEGORY_ADD), edit: can(currentUser, CARD_RECEIPTS.CATEGORY_EDIT),
    reorder: can(currentUser, CARD_RECEIPTS.CATEGORY_REORDER), remove: can(currentUser, CARD_RECEIPTS.CATEGORY_DELETE)
  };

  useEffect(() => {
    api.listCategories().then((r) => setList(r.categories)).catch((e: Error) => setError(e.message)).finally(() => setLoading(false));
  }, []);
  const say = (text: string) => { setToast(text); window.setTimeout(() => setToast(''), 2600); };
  const replace = (c: Category) => setList((l) => l.map((x) => (x._id === c._id ? c : x)));

  const saveOrder = async (next: Category[]) => {
    const before = list;
    setList(next);
    try { setList((await api.reorderCategories(next.map((c) => c._id))).categories); say('Order saved'); } catch (e) { setList(before); setError((e as Error).message); }
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= list.length || from === to) return;
    const next = [...list];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    saveOrder(next);
  };
  const toggle = async (c: Category) => {
    try { replace((await api.editCategory(c._id, { label: c.label, fields: c.fields, active: !c.active })).category); say(c.active ? `${c.label} hidden` : `${c.label} shown`); } catch (e) { setError((e as Error).message); }
  };
  const askDelete = async (c: Category) => {
    try { setOpen({ kind: 'delete', category: c, uses: (await api.categoryUses(c._id)).uses }); } catch (e) { setError((e as Error).message); }
  };

  return (
    <div className="ccr">
      <div className="ccr-page">
        <div className="ccr-head">
          {sidebarToggle}
          <div className="ccr-ttl"><h1>Receipt Categories</h1><span>The list staff pick from, in this order</span></div>
          {allow.add ? <button type="button" className="ccr-btn gold" style={{ marginLeft: 'auto' }} onClick={() => setOpen({ kind: 'add' })}><Plus size={16} aria-hidden="true" /> Add category</button> : null}
        </div>
        {error ? <div className="ccr-note is-error" role="alert">{error}</div> : null}
        <div className={`ccr-box${loading ? ' is-loading' : ''}`}>
          <div className="ccr-cat-row is-head"><span /><span>Category</span><span className="ccr-col-wide">Also asks for</span><span className="ccr-cat-shown">Shown</span><span /></div>
          {list.map((c, i) => {
            const items: RowMenuItem[] = [];
            if (allow.edit) items.push({ key: 'edit', label: 'Edit', icon: Pencil, onClick: () => setOpen({ kind: 'edit', category: c }) });
            if (allow.edit) items.push({ key: 'toggle', label: c.active ? 'Hide' : 'Show', icon: c.active ? EyeOff : Eye, onClick: () => toggle(c) });
            if (allow.reorder && i > 0) items.push({ key: 'up', label: 'Move up', icon: ArrowUp, onClick: () => move(i, i - 1) });
            if (allow.reorder && i < list.length - 1) items.push({ key: 'down', label: 'Move down', icon: ArrowDown, onClick: () => move(i, i + 1) });
            if (allow.remove) items.push({ key: 'delete', label: 'Delete…', icon: Trash2, danger: true, onClick: () => askDelete(c) });
            const asks = ASKS.filter((a) => c.fields[a.key]);
            return (
              <div key={c._id} className={`ccr-cat-row${c.active ? '' : ' is-hidden'}${dragging === c._id ? ' is-dragging' : ''}`}
                draggable={allow.reorder}
                onDragStart={() => setDragging(c._id)}
                onDragEnd={() => setDragging(null)}
                onDragOver={(e) => { if (dragging) e.preventDefault(); }}
                onDrop={(e) => { e.preventDefault(); const from = list.findIndex((x) => x._id === dragging); setDragging(null); move(from, i); }}>
                <button type="button" className="ccr-grip" disabled={!allow.reorder} aria-label={`Drag to reorder ${c.label}`} tabIndex={-1}><GripVertical size={16} /></button>
                <span><b>{c.label}</b>{c.active ? null : <> <span className="ccr-ask">Hidden</span></>}</span>
                <span className="ccr-asks ccr-col-wide">{asks.length ? asks.map((a) => <span key={a.key} className="ccr-ask">{a.label}</span>) : <span className="ccr-muted">Nothing extra</span>}</span>
                <span className="ccr-cat-shown">{c.active ? 'Shown' : 'Hidden'}</span>
                <span>{items.length ? <RowMenu items={items} label={`Actions for ${c.label}`} /> : null}</span>
              </div>
            );
          })}
          {!list.length && !loading ? <div className="ccr-empty"><h3>No categories yet</h3></div> : null}
        </div>
        <p className="ccr-sub" style={{ margin: 0 }}>A hidden category can’t be picked for new receipts but stays on the ones that have it.</p>
      </div>

      {open?.kind === 'add' || open?.kind === 'edit' ? (
        <CategoryForm category={open.kind === 'edit' ? open.category : null} all={list} onClose={() => setOpen(null)}
          onSave={async (v) => {
            if (open.kind === 'edit') replace((await api.editCategory(open.category._id, { ...v, active: open.category.active })).category);
            else { const { category } = await api.addCategory(v); setList((l) => [...l, category]); }
            setOpen(null);
            say(open.kind === 'edit' ? 'Category saved' : `${v.label} added`);
          }} />
      ) : null}
      {open?.kind === 'delete' ? (
        <DeleteCategoryForm category={open.category} all={list} uses={open.uses} onClose={() => setOpen(null)}
          onDelete={async (to) => {
            const r = await api.deleteCategory(open.category._id, to);
            setList((l) => l.filter((x) => x._id !== open.category._id));
            setOpen(null);
            say(r.moved ? `Deleted; ${r.moved} moved` : 'Category deleted');
          }} />
      ) : null}
      {toast ? <div className="ccr-toast" role="status">{toast}</div> : null}
    </div>
  );
}
