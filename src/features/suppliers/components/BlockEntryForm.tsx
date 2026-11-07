import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, ImagePlus, Loader2, Plus, RotateCcw, Trash2 } from 'lucide-react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormField, FormPicker, FormRow, FormSection, SegmentedToggle } from '../../../components/shared/form/FormControls';
import { goToField } from '../../../components/shared/form/formFocus';
import { compressImage } from '../../../utils/attachmentFiles';
import { newVisitId } from '../../../utils/visitForm';
import { MAX_BUNDLES, parseSize, slabsProblem, supplierMayEdit, ENTRY_PROBLEM_TEXT } from '../../../utils/supplierBlocks';
import { languageEnglish } from '../../../utils/supplierI18n';
import { uploadBlockPhoto, type EntryBody } from '../suppliersApi';
import { bundleLabelOf } from '../supplierPosView';
import type { Block, Bundle, Po, SupplierRow } from '../types';

type Photo = { url: string; preview: string; state: 'done' | 'uploading' | 'failed'; data?: string };
type Row = { id: string; n: number | null; slabs: string; photo: Photo | null; before: Bundle | null };

export type BlockEntryFormProps = {
  /** A new block on this PO… */
  po?: Po | null;
  /** …or what the supplier sent for a block already offered (new photos, more bundles). */
  block?: Block | null;
  supplier: SupplierRow | null;
  onSave: (body: EntryBody & { lineId: string; note: string }, id: string) => Promise<unknown>;
  onClose: () => void;
};

const LABELS = { lineId: 'Material', blockNumber: 'Block #', size: 'Size', bundles: 'Bundles' };
// Photos picked together go in the order the supplier sent them: WhatsApp and
// phones name them by time, so a natural sort by name is their order.
const byName = (a: File, b: File) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
const needsPhoto = (r: Row) => !r.photo || (r.before?.status === 'retake' && r.photo.url === r.before.photoUrl && r.photo.state === 'done');

/**
 * Add block for the supplier (2026-11-07, owner's ask): when a supplier
 * emails or WhatsApps the bundle photos instead of using the portal. The
 * same form adds a new block to a PO, or enters what they sent for a block
 * already offered — a new photo asked, an unlocked bundle, a bundle in place
 * of a rejected one. Photos upload the moment they're picked (several at
 * once fill the bundles in order); Send puts the bundles in step 1 like any
 * block. Rules: applyEntry in src/utils/supplierBlocks.ts.
 */
export default function BlockEntryForm({ po, block, supplier, onSave, onClose }: BlockEntryFormProps) {
  const editing = Boolean(block);
  const supplierName = block?.supplierName || po?.supplierName || supplier?.name || 'the supplier';
  const lines = po?.lines || [];
  const startUnit: 'in' | 'cm' = block?.size?.unit || (supplier && supplier.language !== 'en' ? 'cm' : 'in');
  const startRows = useMemo<Row[]>(() => (block
    ? block.bundles.filter(supplierMayEdit).map((b) => ({ id: b.id, n: b.n, slabs: b.slabs ? String(b.slabs) : '', before: b, photo: b.photoUrl ? { url: b.photoUrl, preview: b.photoUrl, state: 'done' } : null }))
    : []), [block]);
  const [rows, setRows] = useState<Row[]>(startRows);
  const [lineId, setLineId] = useState(block?.lineId || (lines.length === 1 ? lines[0]!.id : ''));
  const [blockNumber, setBlockNumber] = useState(block?.blockNumber || '');
  const [length, setLength] = useState(block?.size ? String(block.size.length) : '');
  const [height, setHeight] = useState(block?.size ? String(block.size.height) : '');
  const [unit, setUnit] = useState<'in' | 'cm'>(startUnit);
  const [note, setNote] = useState('');
  const [eachSlabs, setEachSlabs] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState('');
  const [serverProblems, setServerProblems] = useState<Record<string, unknown>>({});
  const [dragging, setDragging] = useState(false);
  const [blockId] = useState(() => block?.id || newVisitId());
  const many = useRef<HTMLInputElement>(null);
  const one = useRef<HTMLInputElement>(null);
  const forRow = useRef<string>('');

  // Leaving with a photo still uploading asks first.
  const uploading = rows.filter((r) => r.photo?.state === 'uploading').length;
  useEffect(() => {
    if (!uploading) return undefined;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [uploading]);

  const touch = () => { setServerError(''); setServerProblems({}); };
  const setRow = (id: string, patch: Partial<Row>) => { touch(); setRows((all) => all.map((r) => (r.id === id ? { ...r, ...patch } : r))); };

  const upload = async (id: string, data: string) => {
    setRows((all) => all.map((r) => (r.id === id ? { ...r, photo: { url: '', preview: data, state: 'uploading', data } } : r)));
    try {
      const { url } = await uploadBlockPhoto(data);
      setRows((all) => all.map((r) => (r.id === id && r.photo?.data === data ? { ...r, photo: { url, preview: data, state: 'done' } } : r)));
    } catch {
      setRows((all) => all.map((r) => (r.id === id && r.photo?.data === data ? { ...r, photo: { url: '', preview: data, state: 'failed', data } } : r)));
    }
  };
  const read = async (file: File) => { try { return await compressImage(file, 1800, 0.82); } catch { return ''; } };

  /** Several photos at once: the bundles still missing one first, in order, then a new bundle each. */
  const addPhotos = async (files: File[]) => {
    touch();
    const images = files.filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name)).sort(byName);
    if (!images.length) return;
    const open = rows.filter(needsPhoto).map((r) => r.id);
    const room = MAX_BUNDLES - (block ? block.bundles.filter((b) => !supplierMayEdit(b)).length : 0) - rows.length;
    const targets: string[] = [];
    const fresh: Row[] = [];
    images.forEach((_, i) => {
      if (i < open.length) targets.push(open[i]!);
      else if (fresh.length < room) { const id = newVisitId(); fresh.push({ id, n: null, slabs: eachSlabs, photo: null, before: null }); targets.push(id); }
    });
    if (fresh.length) setRows((all) => [...all, ...fresh]);
    if (images.length > targets.length) setServerError(`A block has up to ${MAX_BUNDLES} bundles, so ${images.length - targets.length} photo${images.length - targets.length === 1 ? ' was' : 's were'} left out.`);
    await Promise.all(targets.map(async (id, i) => {
      const data = await read(images[i]!);
      if (data) await upload(id, data);
      else setRows((all) => all.map((r) => (r.id === id ? { ...r, photo: { url: '', preview: '', state: 'failed' } } : r)));
    }));
  };
  const pickFor = (id: string) => { forRow.current = id; one.current?.click(); };
  const onOne = async (file: File | undefined) => {
    const id = forRow.current;
    if (!file || !id) return;
    touch();
    const data = await read(file);
    if (data) await upload(id, data);
  };
  const addRow = () => { touch(); setRows((all) => [...all, { id: newVisitId(), n: null, slabs: eachSlabs, photo: null, before: null }]); };
  const fillSlabs = (v: string) => {
    const clean = v.replace(/[^\d]/g, '');
    const was = eachSlabs;
    setEachSlabs(clean);
    touch();
    // Every bundle still blank or on the old "each" number follows; one typed differently stays.
    setRows((all) => all.map((r) => (!r.slabs || r.slabs === was ? { ...r, slabs: clean } : r)));
  };

  // Numbers for the new bundles: after the block's last.
  const lastN = Math.max(0, ...(block?.bundles || []).map((b) => b.n));
  let counter = lastN;
  const shown = rows.map((r) => ({ ...r, n: r.n ?? ++counter }));

  const rowProblem = (r: Row): string => {
    const server = (serverProblems.bundles as Record<string, string> | undefined)?.[r.id];
    if (server) return server;
    if (r.photo?.state === 'failed') return 'The photo didn’t upload. Try again.';
    if (needsPhoto(r)) return r.before?.status === 'retake' ? ENTRY_PROBLEM_TEXT.newPhoto! : ENTRY_PROBLEM_TEXT.photo!;
    if (slabsProblem(r.slabs)) return ENTRY_PROBLEM_TEXT.slabs!;
    return '';
  };
  const size = parseSize(length, height, unit);
  const problems: Record<string, unknown> = {
    ...(!editing && !lineId ? { lineId: 'Choose the material' } : {}),
    ...(!blockNumber.trim() ? { blockNumber: ENTRY_PROBLEM_TEXT.blockNumber } : {}),
    ...(!size ? { size: length || height ? 'Check the size' : ENTRY_PROBLEM_TEXT.size } : {}),
    ...(!rows.length ? { bundles: 'Add the photos the supplier sent' } : rows.some(rowProblem) ? { bundles: 'A bundle needs attention' } : {}),
    ...Object.fromEntries(Object.entries(serverProblems).filter(([k]) => k !== 'bundles'))
  };
  const errors = submitted ? problems : {};
  const slabs = rows.reduce((s, r) => s + (Number(r.slabs) || 0), 0);
  const dirty = rows.length !== startRows.length || rows.some((r) => r.photo?.url !== r.before?.photoUrl || r.slabs !== (r.before?.slabs ? String(r.before.slabs) : ''))
    || blockNumber !== (block?.blockNumber || '') || Boolean(note) ? 1 : 0;

  const submit = async () => {
    setSubmitted(true);
    if (uploading) return;
    const first = (Object.keys(LABELS) as (keyof typeof LABELS)[]).find((k) => problems[k]);
    if (first) { goToField(first === 'bundles' ? (rows.find(rowProblem)?.id ? `bundle-${rows.find(rowProblem)!.id}` : 'bundles') : first); return; }
    setSaving(true);
    try {
      await onSave({
        lineId, note, blockNumber: blockNumber.trim(), length, height, unit,
        bundles: rows.map((r) => ({ id: r.id, slabs: Number(r.slabs) || null, ...(r.photo?.url ? { photoUrl: r.photo.url } : {}) }))
      }, blockId);
    } catch (err) {
      const e = err as Error & { problems?: Record<string, unknown> };
      setServerProblems(e.problems && typeof e.problems === 'object' ? e.problems : {});
      setServerError(e.message);
      setSaving(false);
    }
  };

  const locked = block ? block.bundles.filter((b) => !supplierMayEdit(b)) : [];
  const rejected = locked.filter((b) => b.status === 'rejected');
  const line = lines.find((l) => l.id === lineId);
  const cov = po?.coverage.find((c) => c.lineId === lineId);
  const tells = supplier?.logins.some((l) => l.active && l.hasPassword)
    ? `${supplierName} sees it in their portal and hears the decisions as usual.`
    : supplier?.email
      ? `${supplierName} has no portal login: the decisions are emailed to ${supplier.email}${supplier.language !== 'en' ? ` in ${languageEnglish(supplier.language)}` : ''}, with the photos.`
      : `${supplierName} has no portal login or email, so tell them the decisions yourself (or add their email on the Suppliers tab).`;

  return (
    <FormModal
      title={editing ? <>Enter what {supplierName} sent <span className="fm-title-sub">· block {block!.blockNumber}</span></> : <>Add block for {supplierName} <span className="fm-title-sub">· PO {po?.poNumber}</span></>}
      size="l"
      onClose={onClose}
      onSubmit={submit}
      submitLabel={uploading ? `Uploading ${uploading} photo${uploading === 1 ? '' : 's'}…` : `Send for review${rows.length ? ` · ${rows.length} bundle${rows.length === 1 ? '' : 's'}` : ''}`}
      submitDisabled={Boolean(uploading)}
      saving={saving}
      savingLabel="Sending…"
      dirtyCount={dirty}
      discardTitle={editing ? 'Discard what you entered?' : 'Discard this block?'}
      errors={errors}
      showErrors={submitted}
      fieldLabels={LABELS}
      footerNote={rows.length ? `${rows.length} bundle${rows.length === 1 ? '' : 's'} · ${slabs} slabs` : null}
    >
      <div className="sp-entry">
        {serverError ? <div className="sp-form-error" role="alert">{serverError}</div> : null}
        <div className="sp-banner">{tells} It goes through both steps like any block.</div>

        <FormSection number={1} title="The block">
          {editing ? (
            <p className="sp-entry-what"><b>{block!.material}</b>{block!.thickness ? ` · ${block!.thickness}` : ''}{block!.finish ? ` · ${block!.finish}` : ''}</p>
          ) : lines.length > 1 ? (
            <FormField name="lineId" id="lineId" label="Material" required error={errors.lineId as string}>
              <FormPicker id="lineId" value={lineId} onChange={(v) => { touch(); setLineId(v); }} sheetTitle="Material" keepInForm error={errors.lineId}
                options={lines.map((l) => {
                  const c = po?.coverage.find((x) => x.lineId === l.id);
                  return { value: l.id, label: l.material, description: `${[l.thickness, l.finish].filter(Boolean).join(' · ')}${c ? ` · ${c.approved} of ${l.slabs} approved` : ''}` };
                })} />
            </FormField>
          ) : line ? (
            <p className="sp-entry-what"><b>{line.material}</b>{line.thickness ? ` · ${line.thickness}` : ''}{line.finish ? ` · ${line.finish}` : ''}{cov ? <span className="sp-entry-mut"> · {cov.approved} of {line.slabs} slabs approved</span> : null}</p>
          ) : null}
          <FormRow>
            <FormField name="blockNumber" id="blockNumber" label="Block #" required error={errors.blockNumber as string}>
              <input id="blockNumber" className="fm-input no-capitalize" value={blockNumber} maxLength={30} autoComplete="off"
                onChange={(e) => { touch(); setBlockNumber(e.target.value); }} />
            </FormField>
            <FormField name="size" id="size" label="Size (length × height)" required error={errors.size as string}>
              <div className="sp-entry-size">
                <input id="size" className="fm-input sp-num" inputMode="decimal" aria-label="Length" placeholder="Length" value={length} onChange={(e) => { touch(); setLength(e.target.value.replace(',', '.').replace(/[^\d.]/g, '')); }} />
                <span aria-hidden="true">×</span>
                <input className="fm-input sp-num" inputMode="decimal" aria-label="Height" placeholder="Height" value={height} onChange={(e) => { touch(); setHeight(e.target.value.replace(',', '.').replace(/[^\d.]/g, '')); }} />
                <SegmentedToggle label="Unit" value={unit} onChange={(u) => { touch(); setUnit(u); }} options={[{ value: 'cm', label: 'cm' }, { value: 'in', label: 'in' }]} />
              </div>
            </FormField>
          </FormRow>
          {!editing ? (
            <FormField name="note" id="note" label="Note from the supplier">
              <textarea id="note" className="fm-input fm-textarea" rows={2} maxLength={1500} autoCapitalize="sentences" value={note}
                placeholder="Anything they said about the block" onChange={(e) => setNote(e.target.value)} />
            </FormField>
          ) : null}
        </FormSection>

        <FormSection number={2} title="Bundles">
          {locked.length ? (
            <p className="sp-entry-mut">
              {locked.length} other bundle{locked.length === 1 ? ' is' : 's are'} with Easy Stones and stay{locked.length === 1 ? 's' : ''} as {locked.length === 1 ? 'it is' : 'they are'}
              {rejected.length ? ` · bundle${rejected.length === 1 ? '' : 's'} ${rejected.map((b) => b.n).join(', ')} rejected — add a bundle in ${rejected.length === 1 ? 'its' : 'their'} place below` : ''}.
            </p>
          ) : null}

          <div
            id="bundles"
            data-field="bundles"
            className={`sp-drop${dragging ? ' is-over' : ''}${submitted && !rows.length ? ' is-error' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); addPhotos([...e.dataTransfer.files]); }}
          >
            <ImagePlus size={22} aria-hidden="true" />
            <span><b>Drop the photos here</b> or <button type="button" className="sp-link" onClick={() => many.current?.click()}>choose them</button> — one photo per bundle, in the order they were sent.</span>
            <input ref={many} type="file" accept="image/*" multiple hidden onChange={(e) => { addPhotos([...(e.target.files || [])]); e.target.value = ''; }} />
            <input ref={one} type="file" accept="image/*" hidden onChange={(e) => { onOne(e.target.files?.[0]); e.target.value = ''; }} />
          </div>

          {rows.length ? (
            <div className="sp-entry-each">
              <label htmlFor="eachSlabs">Slabs in each bundle</label>
              <input id="eachSlabs" className="fm-input sp-num" inputMode="numeric" value={eachSlabs} placeholder="e.g. 8" onChange={(e) => fillSlabs(e.target.value)} />
              <span className="sp-entry-mut">Change any bundle below that differs.</span>
            </div>
          ) : null}

          <div className="sp-entry-grid">
            {shown.map((r) => {
              const problem = submitted ? rowProblem(r) : '';
              const label = r.before ? bundleLabelOf(r.before.status) : null;
              return (
                <div key={r.id} className={`sp-entry-card${problem ? ' is-error' : ''}`} data-field={`bundle-${r.id}`}>
                  <button type="button" className="sp-entry-photo" onClick={() => pickFor(r.id)} aria-label={`${r.photo ? 'Change' : 'Add'} the photo of bundle ${r.n}`}>
                    {r.photo?.preview ? <img src={r.photo.preview} alt="" /> : <span className="sp-bnone"><Camera size={20} /> Add photo</span>}
                    {r.photo?.state === 'uploading' ? <span className="sp-entry-state"><Loader2 size={16} className="sp-spin" /> Uploading</span> : null}
                    {r.photo?.state === 'failed' ? <span className="sp-entry-state is-bad">Didn’t upload</span> : null}
                  </button>
                  <div className="sp-entry-row">
                    <b>Bundle {r.n}</b>
                    {label && r.before?.status !== 'draft' ? <span className="sp-entry-mut">{label.label}{r.before?.status === 'retake' ? ' — needs the new photo' : ''}</span> : null}
                    {!r.before || (r.before.status === 'draft' && !r.before.round) ? (
                      <button type="button" className="sp-iconbtn is-small" aria-label={`Remove bundle ${r.n}`} onClick={() => { touch(); setRows((all) => all.filter((x) => x.id !== r.id)); }}><Trash2 size={15} /></button>
                    ) : null}
                  </div>
                  <div className="sp-entry-row">
                    <label htmlFor={`slabs-${r.id}`} className="sp-entry-mut">Slabs</label>
                    <input id={`slabs-${r.id}`} className={`fm-input sp-num${problem === ENTRY_PROBLEM_TEXT.slabs ? ' is-error' : ''}`} inputMode="numeric" value={r.slabs}
                      onChange={(e) => setRow(r.id, { slabs: e.target.value.replace(/[^\d]/g, '') })} />
                    {r.photo?.state === 'failed' && r.photo.data ? (
                      <button type="button" className="sp-textbtn" onClick={() => upload(r.id, r.photo!.data!)}><RotateCcw size={14} /> Try again</button>
                    ) : null}
                  </div>
                  {problem ? <span className="fm-error">{problem}</span> : null}
                </div>
              );
            })}
          </div>
          {rows.length + locked.length < MAX_BUNDLES ? (
            <button type="button" className="sp-textbtn" onClick={addRow}><Plus size={15} /> Add a bundle</button>
          ) : null}
        </FormSection>
      </div>
    </FormModal>
  );
}
