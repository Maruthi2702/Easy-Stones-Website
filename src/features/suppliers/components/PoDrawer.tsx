import { useEffect } from 'react';
import { Ban, CheckCircle2, ImagePlus, Mail, Pencil, RotateCcw, X } from 'lucide-react';
import { lockPage, unlockPage } from '../../../components/shared/pageLock';
import RowMenu, { type RowMenuItem } from '../../../components/shared/RowMenu';
import { noteFor } from '../../../utils/supplierBlocks';
import { languageEnglish } from '../../../utils/supplierI18n';
import { blockStageOf, dayText, poStageOf, poTotals, timeAgo, whenText } from '../supplierPosView';
import { Chip, CoverageBar } from './PoList';
import type { Block, Po } from '../types';

export type PoDrawerProps = {
  po: Po;
  loading: boolean;
  canManage: boolean;
  onEdit: () => void;
  onStatus: (status: 'open' | 'closed' | 'cancelled') => void;
  onNotify: () => void;
  onOpenBlock: (b: Block) => void;
  /** Add a block for the supplier from photos they emailed / sent on WhatsApp. */
  onAddBlock?: () => void;
  onClose: () => void;
};

/**
 * A PO opened: its materials and how much of each is approved, every block
 * the supplier sent with where it stands, the note they read, and the PO's
 * history. ⋯ holds Edit, Email the supplier again, Close / Reopen and Cancel
 * for whoever may manage POs, who can also add a block for the supplier from
 * the photos they emailed or sent on WhatsApp.
 */
export default function PoDrawer({ po, loading, canManage, onEdit, onStatus, onNotify, onOpenBlock, onAddBlock, onClose }: PoDrawerProps) {
  useEffect(() => { lockPage(); return () => unlockPage(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const st = poStageOf(po.stage);
  const totals = poTotals(po);
  const note = noteFor(po.note, 'en');
  const items: RowMenuItem[] = canManage ? [
    ...(po.status !== 'cancelled' ? [{ key: 'edit', label: 'Edit PO', icon: Pencil, onClick: onEdit }] : []),
    ...(po.status === 'open' && onAddBlock ? [{ key: 'block', label: 'Add block for the supplier', icon: ImagePlus, onClick: onAddBlock }] : []),
    ...(po.status === 'open' ? [{ key: 'mail', label: 'Email the supplier again', icon: Mail, onClick: onNotify }] : []),
    ...(po.status === 'open' ? [{ key: 'close', label: 'Close PO (nothing more to offer)', icon: CheckCircle2, onClick: () => onStatus('closed'), divider: true }] : []),
    ...(po.status !== 'open' ? [{ key: 'open', label: 'Reopen PO', icon: RotateCcw, onClick: () => onStatus('open'), divider: true }] : []),
    ...(po.status !== 'cancelled' ? [{ key: 'cancel', label: 'Cancel PO…', icon: Ban, onClick: () => onStatus('cancelled'), danger: true }] : [])
  ] : [];

  return (
    <>
      <div className="sp-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="sp-drawer" role="dialog" aria-modal="true" aria-label={`PO ${po.poNumber}`}>
        <header className="sp-drawer-h">
          <div className="sp-drawer-ttl">
            <div className="sp-row"><h2>PO {po.poNumber}</h2><Chip colour={st.colour}>{st.label}</Chip><span className="sp-tag">{po.source === 'sps' ? 'From SPS' : 'Typed'}</span></div>
            <span className="sp-sub is-13">{po.supplierName}{po.supplierCountry ? ` (${po.supplierCountry})` : ''} · ships to {po.shipTo}{po.readyBy ? ` · ready by ${dayText(po.readyBy)}` : ''}</span>
            <span className="sp-sub is-13">Buyer {po.buyerName || '—'} · assigned {timeAgo(po.assignedAt)}</span>
          </div>
          <div className="sp-drawer-nav">
            {items.length ? <RowMenu label="PO actions" items={items} /> : null}
            <button type="button" className="sp-x" aria-label="Close" onClick={onClose}><X size={16} strokeWidth={2.4} /></button>
          </div>
        </header>

        <div className={`sp-drawer-b${loading ? ' is-loading' : ''}`}>
          {po.status !== 'open' ? (
            <div className={`sp-banner ${po.status === 'cancelled' ? 'is-error' : 'is-info'}`}>
              {po.status === 'cancelled' ? 'Cancelled' : 'Closed'}{po.statusReason ? `: ${po.statusReason}` : ''}. The supplier can’t offer anything more on it.
            </div>
          ) : null}

          <section className="sp-section">
            <h3>Materials · {totals.approved} of {totals.ordered} slabs approved</h3>
            <div className="sp-mlines">
              {po.lines.map((l) => {
                const c = po.coverage.find((x) => x.lineId === l.id);
                return (
                  <div key={l.id} className="sp-mline">
                    <div className="sp-who"><b>{l.material}</b><span>{[l.thickness, l.finish].filter(Boolean).join(' · ') || '—'}</span></div>
                    <CoverageBar ordered={l.slabs} approved={c?.approved || 0} waiting={(c?.review || 0) + (c?.final || 0)} />
                    <span className="sp-sub">{c?.rejected ? `${c.rejected} rejected · ` : ''}{c?.supplier ? `${c.supplier} with the supplier` : ''}</span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="sp-section">
            <div className="sp-section-h">
              <h3>Blocks offered · {po.blocks?.length || 0}{po.draftBlocks ? <span className="sp-sub"> · the supplier is preparing {po.draftBlocks} more</span> : null}</h3>
              {canManage && po.status === 'open' && onAddBlock ? (
                <button type="button" className="sp-btn is-small" onClick={onAddBlock}><ImagePlus size={15} /> Add block</button>
              ) : null}
            </div>
            {po.blocks?.length ? (
              <div className="sp-queue">
                {po.blocks.map((b) => {
                  const bs = blockStageOf(b.stage);
                  const c = b.counts;
                  const line = [c.approved && `${c.approved} approved`, c.final && `${c.final} for final approval`, c.review && `${c.review} to review`, c.rejected && `${c.rejected} rejected`, c.retake && `${c.retake} new photo asked`, c.unlocked && `${c.unlocked} unlocked`].filter(Boolean).join(' · ');
                  return (
                    <button key={b.id} type="button" className="sp-qcard" onClick={() => onOpenBlock(b)}>
                      <span className="sp-qphotos" aria-hidden="true">{b.bundles.slice(0, 4).map((x) => (x.photoUrl ? <img key={x.id} src={x.photoUrl} alt="" loading="lazy" /> : <span key={x.id} className="sp-qph" />))}</span>
                      <span className="sp-qbody">
                        <span className="sp-qtop"><b>Block {b.blockNumber}</b><Chip colour={bs.colour}>{bs.label}</Chip></span>
                        <span>{b.material}{b.thickness ? ` ${b.thickness}` : ''}</span>
                        <span className="sp-sub">{b.bundles.length} bundles, {b.bundles.reduce((s, x) => s + (Number(x.slabs) || 0), 0)} slabs · {line}{b.enteredBy ? ` · added by ${b.enteredBy}` : ''}</span>
                      </span>
                      <span className="sp-qwhen"><span className="sp-sub">Sent</span><b>{timeAgo(b.firstSentAt)}</b></span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="sp-sub">
                Nothing offered yet.{canManage && po.status === 'open' && onAddBlock ? ` If ${po.supplierName} emails or WhatsApps the photos, Add block enters them for them.` : ''}
              </p>
            )}
          </section>

          {note ? (
            <section className="sp-section">
              <h3>Note to the supplier</h3>
              <div className="sp-note is-ours">
                <span>{note.original}</span>
                {po.note?.translations && Object.keys(po.note.translations).length ? (
                  <span className="sp-sub">They read it in {Object.keys(po.note.translations).map(languageEnglish).join(', ')}: “{Object.values(po.note.translations)[0]}”</span>
                ) : null}
              </div>
            </section>
          ) : null}

          {po.history?.length ? (
            <details className="sp-history" open>
              <summary>History · {po.history.length}</summary>
              <ol>
                {[...po.history].reverse().map((h, i) => (
                  <li key={i}><span className="sp-sub">{whenText(h.at)}</span> <b>{h.by}</b> {h.action}{h.changes ? ` — ${h.changes}` : ''}</li>
                ))}
              </ol>
            </details>
          ) : null}
        </div>
      </aside>
    </>
  );
}
