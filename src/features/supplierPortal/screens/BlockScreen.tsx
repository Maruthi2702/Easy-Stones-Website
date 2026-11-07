import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Camera, Check, CloudUpload, Lock, Minus, Plus, RotateCcw, Trash2, WifiOff, X } from 'lucide-react';
import ImageGallery from '../../../components/shared/ImageGallery';
import { reasonText, type StringKey } from '../../../utils/supplierI18n';
import { cmOf, inchesOf, parseSize, sendProblems, supplierMayEdit, MAX_SLABS, MIN_SLABS, type BundleLike } from '../../../utils/supplierBlocks';
import { newVisitId } from '../../../utils/visitForm';
import * as api from '../portalApi';
import type { PortalError } from '../portalApi';
import { usePortal } from '../portalContext';
import { usePhotoUploads } from '../usePhotoUploads';
import { Loading, NoteBox, PortalHeader } from '../components';
import type { PortalBlock, PortalBundle } from '../types';

const SAVE_AFTER_MS = 600;
const KNOWN_CODES: readonly string[] = ['offline', 'lockNote', 'poClosed', 'poCancelled', 'needSize', 'needSlabs', 'needPhoto', 'checkMarked'];

/**
 * A block (canvas "Offer a block" and "Result"): its number and size, then a
 * row per bundle — the photo (taken on the phone, uploading at once), the
 * slab count, and once sent, what Easy Stones decided in the supplier's
 * language. What the supplier may still change is editable; Send stays off,
 * saying what's missing ("2 photos to go"), until everything is there.
 * Approved bundles show their lock.
 */
export default function BlockScreen({ onSignedOut }: { onSignedOut: () => void }) {
  const { id = '' } = useParams();
  const { t, lang, ago } = usePortal();
  const navigate = useNavigate();
  const [block, setBlock] = useState<PortalBlock | null>(null);
  const [error, setError] = useState('');
  const [fields, setFields] = useState({ blockNumber: '', length: '', height: '', unit: 'in' as 'in' | 'cm', note: '' });
  const [fieldsDirty, setFieldsDirty] = useState(false);
  const [slabs, setSlabs] = useState<Record<string, number | null>>({});
  const [sending, setSending] = useState(false);
  const [justSent, setJustSent] = useState(false);
  const [tried, setTried] = useState(false);
  const [askDelete, setAskDelete] = useState(false);
  const [viewing, setViewing] = useState<{ urls: string[]; index: number } | null>(null);
  const fieldTimer = useRef<number | undefined>(undefined);
  const slabTimers = useRef(new Map<string, number>());
  const fileRefs = useRef(new Map<string, HTMLInputElement | null>());
  const topRef = useRef<HTMLDivElement>(null);

  const fail = useCallback((e: unknown) => {
    const err = e as PortalError;
    if (err.status === 401) { onSignedOut(); return; }
    setError(t(err.status === 404 ? 'nothingMatches' : KNOWN_CODES.includes(err.code) ? err.code as StringKey : 'serverError'));
  }, [onSignedOut, t]);

  /** The server's block, and the typed fields it holds (unless someone is typing). */
  const take = useCallback((b: PortalBlock, syncFields = false) => {
    setBlock(b);
    setSlabs((cur) => {
      const next: Record<string, number | null> = {};
      for (const x of b.bundles) next[x.id] = slabTimers.current.has(x.id) ? cur[x.id] ?? x.slabs : x.slabs;
      return next;
    });
    if (syncFields) {
      setFields({
        blockNumber: b.blockNumber, note: b.note?.text || '',
        length: b.size ? String(b.size.length) : '', height: b.size ? String(b.size.height) : '', unit: b.size?.unit || 'in'
      });
    }
  }, []);
  useEffect(() => { api.getBlock(id).then((r) => take(r.block, true)).catch(fail); }, [id, take, fail]);
  const { uploads, take: takePhoto, retry, pending } = usePhotoUploads(id, (b) => take(b));

  // ── Saving what's typed ──────────────────────────────────────────────────
  const saveFields = useCallback(async (f = fields) => {
    window.clearTimeout(fieldTimer.current);
    fieldTimer.current = undefined;
    const typedSize = f.length.trim() || f.height.trim();
    if (typedSize && !parseSize(f.length, f.height, f.unit)) { setFieldsDirty(false); return; }
    try {
      const { block: b } = await api.editBlock(id, { blockNumber: f.blockNumber, length: f.length, height: f.height, unit: f.unit, note: f.note });
      take(b);
      setFieldsDirty(false);
    } catch (e) { fail(e); }
  }, [fields, id, take, fail]);
  const setField = (patch: Partial<typeof fields>) => {
    const next = { ...fields, ...patch };
    setFields(next);
    setFieldsDirty(true);
    window.clearTimeout(fieldTimer.current);
    fieldTimer.current = window.setTimeout(() => saveFields(next), SAVE_AFTER_MS);
  };
  const changeSlabs = (bundle: PortalBundle, value: number | null) => {
    setSlabs((s) => ({ ...s, [bundle.id]: value }));
    window.clearTimeout(slabTimers.current.get(bundle.id));
    slabTimers.current.set(bundle.id, window.setTimeout(async () => {
      slabTimers.current.delete(bundle.id);
      try { take((await api.setSlabs(id, bundle.id, value)).block); } catch (e) { fail(e); }
    }, SAVE_AFTER_MS));
  };
  /** Everything typed is saved before Send. */
  const flush = async () => {
    if (fieldTimer.current || fieldsDirty) await saveFields();
    const waiting = [...slabTimers.current.keys()];
    for (const bid of waiting) {
      window.clearTimeout(slabTimers.current.get(bid));
      slabTimers.current.delete(bid);
      take((await api.setSlabs(id, bid, slabs[bid] ?? null)).block);
    }
  };
  useEffect(() => () => { window.clearTimeout(fieldTimer.current); }, []);

  // ── What can be sent ─────────────────────────────────────────────────────
  const view = useMemo(() => {
    if (!block) return null;
    const bundles: BundleLike[] = block.bundles.map((b) => ({
      id: b.id, n: b.n, slabs: slabs[b.id] ?? b.slabs, photoUrl: b.photoUrl, status: b.status, photoAt: b.photoAt, sentAt: b.sentAt
    }));
    const size = parseSize(fields.length, fields.height, fields.unit);
    return sendProblems({ blockNumber: fields.blockNumber, size, bundles, sentAt: block.sentAt });
  }, [block, slabs, fields]);

  if (!block || !view) {
    return <div className="spx-page"><PortalHeader back="/supplier" title={t('block', { n: '…' })} /><main className="spx-main">{error ? <div className="spx-error">{error}</div> : <Loading />}</main></div>;
  }

  const editable = block.bundles.filter(supplierMayEdit);
  const mayChange = block.poOpen && (!block.sent || editable.length > 0);
  const missingPhotos = Object.values(view.problems.bundles).filter((p) => p.includes('photo') || p.includes('newPhoto')).length;
  const missingSlabs = Object.values(view.problems.bundles).some((p) => p.includes('slabs'));
  const totalSlabs = block.bundles.reduce((s, b) => s + (Number(slabs[b.id] ?? b.slabs) || 0), 0);
  const photosDone = block.bundles.filter((b) => b.photoUrl).length;
  const sendLabel = pending ? t('uploading')
    : missingPhotos ? (missingPhotos === 1 ? t('photoToGo') : t('photosToGo', { n: missingPhotos }))
    : view.problems.block.blockNumber ? t('needBlockNumber')
    : view.problems.block.size ? t('needSize')
    : missingSlabs ? t('needSlabs')
    : block.sent ? t('sendChanges') : t('sendForReview');
  const ready = view.ok && !pending;
  const c = block.counts;
  const allApproved = block.sent && c.approved > 0 && c.approved + c.rejected === c.total;
  const typedSize = parseSize(fields.length, fields.height, fields.unit);
  const other = typedSize ? (fields.unit === 'in' ? cmOf(typedSize) : inchesOf(typedSize)) : null;

  const send = async () => {
    setTried(true);
    if (!ready) return;
    setSending(true);
    setError('');
    try {
      await flush();
      const { block: b } = await api.sendBlock(id);
      take(b);
      setJustSent(true);
      setTried(false);
      topRef.current?.scrollIntoView({ block: 'start' });
    } catch (e) { fail(e); } finally { setSending(false); }
  };
  const addBundle = async () => {
    try { take((await api.addBundle(id, newVisitId())).block); } catch (e) { fail(e); }
  };

  const statusLine = (b: PortalBundle) => {
    if (b.status === 'rejected') return `${t('st_rejected')} · ${reasonText(lang, 'reject', b.reason)}`;
    if (b.status === 'retake') return `${t('st_retake')} · ${reasonText(lang, 'retake', b.reason)}`;
    return t(`st_${b.status}` as StringKey);
  };

  return (
    <div className="spx-page" ref={topRef}>
      <PortalHeader back={`/supplier/po/${block.poId}`} title={block.blockNumber ? t('block', { n: block.blockNumber }) : t('newBlock')}
        sub={`${t('po', { n: block.poNumber })} · ${block.material}${block.thickness ? ` ${block.thickness}` : ''}`} />
      <main className="spx-main has-bar">
        {error ? <div className="spx-error" role="alert">{error} <button type="button" className="spx-link" onClick={() => setError('')}><X size={14} /></button></div> : null}
        {justSent ? <div className="spx-banner is-ok"><Check size={18} /> <span><b>{t('sentTitle')}</b><br />{t('sentBody')}</span></div> : null}

        {block.sent ? (
          <div className="spx-tally">
            {c.approved ? <div><b className="is-ok">{c.approved}</b><span>{t('countApproved')}</span></div> : null}
            {c.final ? <div><b className="is-wait">{c.final}</b><span>{t('countApprovedPending')}</span></div> : null}
            {c.review ? <div><b>{c.review}</b><span>{t('countReview')}</span></div> : null}
            {c.rejected ? <div><b className="is-miss">{c.rejected}</b><span>{t('countRejected')}</span></div> : null}
            {c.retake + c.unlocked ? <div><b className="is-info">{c.retake + c.unlocked}</b><span>{t('countRetake')}</span></div> : null}
          </div>
        ) : null}
        {allApproved ? <div className="spx-banner is-ok"><Check size={18} /> {t('allApproved')}</div> : c.approved && block.sent ? <div className="spx-banner is-ok"><Check size={18} /> {t('someApproved')}</div> : null}
        <NoteBox title={t('messageFromUs')} note={block.decisionNote} />

        <section className="spx-card">
          <div className="spx-form">
            <div className="spx-field">
              <label className="spx-label" htmlFor="spx-bn">{t('blockNumber')} <i>*</i></label>
              <input id="spx-bn" className={`spx-input no-capitalize${tried && view.problems.block.blockNumber ? ' is-error' : ''}`} value={fields.blockNumber} maxLength={30}
                disabled={!mayChange || (block.sent && !editable.length)} onChange={(e) => setField({ blockNumber: e.target.value })} onBlur={() => fieldsDirty && saveFields()} />
            </div>
            <div className="spx-field">
              <span className="spx-label" id="spx-size-l">{t('size')} <i>*</i></span>
              <div className="spx-size" role="group" aria-labelledby="spx-size-l">
                <input className={`spx-input${tried && view.problems.block.size ? ' is-error' : ''}`} inputMode="decimal" aria-label={t('length')} placeholder={fields.unit === 'in' ? '124' : '315'}
                  value={fields.length} disabled={!mayChange} onChange={(e) => setField({ length: e.target.value.replace(/[^\d.,]/g, '') })} onBlur={() => fieldsDirty && saveFields()} />
                <span aria-hidden="true">×</span>
                <input className={`spx-input${tried && view.problems.block.size ? ' is-error' : ''}`} inputMode="decimal" aria-label={t('height')} placeholder={fields.unit === 'in' ? '76' : '193'}
                  value={fields.height} disabled={!mayChange} onChange={(e) => setField({ height: e.target.value.replace(/[^\d.,]/g, '') })} onBlur={() => fieldsDirty && saveFields()} />
                <div className="spx-unit" role="radiogroup" aria-label={t('size')}>
                  {(['in', 'cm'] as const).map((u) => (
                    <button key={u} type="button" role="radio" aria-checked={fields.unit === u} className={fields.unit === u ? 'is-on' : ''} disabled={!mayChange} onClick={() => setField({ unit: u })}>{u}</button>
                  ))}
                </div>
              </div>
              {other ? <span className="spx-sub">= {other.length} × {other.height} {fields.unit === 'in' ? 'cm' : 'in'}</span> : null}
            </div>
          </div>
        </section>

        <div className="spx-bhead">
          <span className="spx-label">{t('bundlesHead')}</span>
          <span className="spx-sub">{t('photosCount', { done: photosDone, n: block.bundles.length, slabs: totalSlabs })}</span>
        </div>
        <div className="spx-bundles">
          {block.bundles.map((b, i) => {
            const up = uploads[b.id];
            const canEdit = supplierMayEdit(b) && block.poOpen;
            const problems = view.problems.bundles[b.id] || [];
            const shownPhoto = up?.preview || b.photoUrl;
            const value = slabs[b.id] ?? b.slabs;
            const prev = block.bundles[i - 1];
            return (
              <div key={b.id} className={`spx-brow is-${b.status}${tried && problems.length ? ' is-error' : ''}`}>
                <button type="button" className="spx-bthumb" disabled={!shownPhoto} aria-label={t('bundle', { n: b.n })}
                  onClick={() => setViewing({ urls: [shownPhoto, ...(b.earlierPhoto ? [b.earlierPhoto] : [])], index: 0 })}>
                  {shownPhoto ? <img src={shownPhoto} alt="" /> : <Camera size={22} aria-hidden="true" />}
                  {b.status === 'approved' ? <span className="spx-lock" aria-hidden="true"><Lock size={12} /></span> : null}
                </button>
                <div className="spx-bbody">
                  <b>{t('bundle', { n: b.n })}</b>
                  {!canEdit ? <span className="spx-sub">{t('slabs', { n: value ?? '—' })}</span> : null}
                  {b.status !== 'draft' && !(b.status === 'unlocked' && canEdit) ? <span className={`spx-st is-${b.status}`}>{statusLine(b)}</span> : null}
                  {b.status === 'unlocked' ? <span className="spx-st is-unlocked">{t('st_unlocked')}</span> : null}
                  {b.comment ? <NoteInline note={b.comment} /> : null}
                  {up?.state === 'waiting' ? <span className="spx-st is-wait"><WifiOff size={13} /> {t('waitingSignal')}</span> : null}
                  {up?.state === 'failed' ? <span className="spx-st is-rejected">{t((up.code && KNOWN_CODES.includes(up.code) ? up.code : 'serverError') as StringKey)} <button type="button" className="spx-link" onClick={() => retry(b.id)}>{t('retry')}</button></span> : null}
                  {tried && problems.includes('photo') ? <span className="spx-st is-rejected">{t('needPhoto')}</span> : null}
                  {problems.includes('newPhoto') && b.status === 'retake' ? <span className="spx-st is-rejected">{t('needNewPhoto')}</span> : null}
                  {b.status === 'rejected' && block.poOpen ? <button type="button" className="spx-link is-block" onClick={addBundle}>{t('replaceBundle', { n: b.n })}</button> : null}
                </div>
                <div className="spx-bact">
                  {canEdit ? (
                    <>
                      {up?.state === 'uploading' ? <span className="spx-st is-wait"><CloudUpload size={14} /> {t('uploading')}</span>
                        : shownPhoto && !problems.includes('newPhoto') ? <span className="spx-st is-ok"><Check size={14} /> {t('saved')}</span> : null}
                      <button type="button" className={`spx-take${shownPhoto && !problems.includes('newPhoto') ? ' is-light' : ''}`} onClick={() => fileRefs.current.get(b.id)?.click()}>
                        {shownPhoto ? <><RotateCcw size={15} /> {t('retake')}</> : <><Camera size={16} /> {t('takePhoto')}</>}
                      </button>
                      <input ref={(el) => { fileRefs.current.set(b.id, el); }} type="file" accept="image/*" capture="environment" hidden
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) takePhoto(b.id, f); e.target.value = ''; }} />
                    </>
                  ) : null}
                </div>
                {canEdit ? (
                  <div className="spx-bfoot">
                    <div className="spx-stepper" role="group" aria-label={t('slabsLabel')}>
                      <button type="button" aria-label={t('fewer')} disabled={!value || value <= MIN_SLABS} onClick={() => changeSlabs(b, Math.max(MIN_SLABS, (value || 0) - 1))}><Minus size={16} /></button>
                      <input inputMode="numeric" aria-label={t('slabsLabel')} className={tried && problems.includes('slabs') ? 'is-error' : ''} value={value ?? ''} placeholder="—"
                        onChange={(e) => { const n = e.target.value.replace(/\D/g, ''); changeSlabs(b, n ? Math.min(MAX_SLABS, Number(n)) : null); }} />
                      <button type="button" aria-label={t('more')} disabled={Boolean(value && value >= MAX_SLABS)}
                        onClick={() => changeSlabs(b, value ? Math.min(MAX_SLABS, value + 1) : (Number(slabs[prev?.id || ''] ?? prev?.slabs) || 8))}><Plus size={16} /></button>
                      <span className="spx-sub">{t('slabsLabel').toLowerCase()}</span>
                    </div>
                    {b.status === 'draft' && !b.round && block.bundles.length > 1 ? (
                      <button type="button" className="spx-iconbtn is-light" aria-label={`${t('remove')} · ${t('bundle', { n: b.n })}`}
                        onClick={async () => { try { take((await api.removeBundle(id, b.id)).block); } catch (e) { fail(e); } }}><Trash2 size={15} /></button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        {block.poOpen && mayChange ? <button type="button" className="spx-btn is-light" onClick={addBundle}><Plus size={17} /> {t('addBundle')}</button> : null}
        {mayChange ? <p className="spx-sub">{t('uploadHint')}</p> : null}

        {mayChange ? (
          <div className="spx-field">
            <label className="spx-label" htmlFor="spx-note">{t('noteToUs')}</label>
            <textarea id="spx-note" className="spx-input is-area" rows={3} maxLength={1500} value={fields.note}
              onChange={(e) => setField({ note: e.target.value })} onBlur={() => fieldsDirty && saveFields()} />
          </div>
        ) : null}

        {c.approved || block.sent ? (
          <div className="spx-locknote"><Lock size={18} aria-hidden="true" /><span>{t('lockNote')}</span></div>
        ) : null}
        {!block.sent ? (
          askDelete ? (
            <div className="spx-card">
              <p>{t('deleteBlockAsk')}</p>
              <div className="spx-row2">
                <button type="button" className="spx-btn is-light" onClick={() => setAskDelete(false)}>{t('cancel')}</button>
                <button type="button" className="spx-btn is-danger" onClick={async () => { try { await api.deleteBlock(id); navigate(`/supplier/po/${block.poId}`, { replace: true }); } catch (e) { fail(e); } }}>{t('delete')}</button>
              </div>
            </div>
          ) : <button type="button" className="spx-link is-block is-danger" onClick={() => setAskDelete(true)}>{t('deleteBlock')}</button>
        ) : null}
        {block.sentAt ? <p className="spx-sub">{t('sent')} {ago(block.sentAt)}</p> : null}
      </main>

      {mayChange && editable.length ? (
        <div className="spx-sendbar">
          <button type="button" className={`spx-btn ${ready ? 'is-gold' : 'is-off'}`} aria-disabled={!ready || sending} onClick={send}>
            {sending ? t('sending') : sendLabel}
          </button>
        </div>
      ) : null}

      {viewing ? (
        <ImageGallery image={viewing.urls[viewing.index]!} index={viewing.index} count={viewing.urls.length} images={viewing.urls}
          onPrev={() => setViewing((v) => (v ? { ...v, index: (v.index - 1 + v.urls.length) % v.urls.length } : v))}
          onNext={() => setViewing((v) => (v ? { ...v, index: (v.index + 1) % v.urls.length } : v))}
          onSelect={(index) => setViewing((v) => (v ? { ...v, index } : v))}
          onClose={() => setViewing(null)} />
      ) : null}
    </div>
  );
}

function NoteInline({ note }: { note: NonNullable<PortalBundle['comment']> }) {
  const { lang } = usePortal();
  const text = (note.lang !== lang && note.translations?.[lang]) || note.text;
  return <span className="spx-quote">“{text}”</span>;
}
