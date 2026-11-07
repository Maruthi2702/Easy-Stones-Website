import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import type { StringKey } from '../../../utils/supplierI18n';
import { newVisitId } from '../../../utils/visitForm';
import { getPo, startBlock, type PortalError } from '../portalApi';
import { usePortal } from '../portalContext';
import { Bar, Loading, NoteBox, PortalHeader } from '../components';
import type { PortalBlock, PortalPo } from '../types';

const KNOWN: readonly string[] = ['offline', 'poClosed', 'poCancelled'];

/**
 * One PO (canvas "Supplier phone · One PO"): Easy Stones' note in their
 * language, each material with how much is approved, the blocks offered on
 * it and where each stands, and "Offer a block" while it's open.
 */
export default function PoScreen({ onSignedOut }: { onSignedOut: () => void }) {
  const { id = '' } = useParams();
  const { t, date } = usePortal();
  const navigate = useNavigate();
  const [po, setPo] = useState<PortalPo | null>(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState('');

  const fail = useCallback((e: unknown) => {
    const err = e as PortalError;
    if (err.status === 401) onSignedOut(); else setError(t(err.status === 404 ? 'nothingMatches' : KNOWN.includes(err.code) ? err.code as StringKey : 'serverError'));
  }, [onSignedOut, t]);
  const load = useCallback(() => getPo(id).then((r) => { setPo(r.po); setError(''); }).catch(fail), [id, fail]);
  useEffect(() => { load(); }, [load]);

  const offer = async (lineId: string) => {
    setStarting(lineId);
    try {
      const { block } = await startBlock(id, newVisitId(), lineId);
      navigate(`/supplier/block/${block.id}`);
    } catch (e) { fail(e); setStarting(''); }
  };

  if (!po) return <div className="spx-page"><PortalHeader back="/supplier" title={t('po', { n: '…' })} /><main className="spx-main">{error ? <div className="spx-error">{error}</div> : <Loading />}</main></div>;
  const open = po.status === 'open';
  const blocks = po.blocks as PortalBlock[];

  return (
    <div className="spx-page">
      <PortalHeader back="/supplier" title={t('po', { n: po.poNumber })} sub={[po.shipTo && t('shipsTo', { place: po.shipTo }), po.readyBy && t('readyBy', { date: date(po.readyBy) })].filter(Boolean).join(' · ')} />
      <main className="spx-main">
        {error ? <div className="spx-error" role="alert">{error}</div> : null}
        {!open ? <div className="spx-banner">{t(po.status === 'cancelled' ? 'poCancelled' : 'poClosed')}</div> : null}
        <NoteBox title={t('noteFromUs')} note={po.note} />
        {po.lines.map((l) => {
          const c = po.coverage.find((x) => x.lineId === l.id);
          const mine = blocks.filter((b) => b.lineId === l.id);
          const covered = Boolean(c && c.approved >= c.ordered);
          return (
            <section key={l.id} className="spx-card is-line">
              <div className="spx-line-h">
                <b>{l.material}</b>
                <span className="spx-sub">{[l.thickness, l.finish].filter(Boolean).join(' · ')}</span>
              </div>
              <Bar ordered={l.slabs} approved={c?.approved || 0} waiting={(c?.review || 0) + (c?.final || 0)} />
              <span className="spx-sub">{t('slabsOrdered', { n: l.slabs })} · {t('slabsApproved', { a: c?.approved || 0, n: l.slabs })}</span>
              {l.note ? <span className="spx-sub">{l.note}</span> : null}
              {mine.length ? (
                <div className="spx-blocks">
                  {mine.map((b) => (
                    <Link key={b.id} to={`/supplier/block/${b.id}`} className={`spx-blockrow is-${b.stage}`}>
                      <span className="spx-thumbs" aria-hidden="true">{b.bundles.slice(0, 3).map((x) => (x.photoUrl ? <img key={x.id} src={x.photoUrl} alt="" loading="lazy" /> : <span key={x.id} />))}</span>
                      <span className="spx-blockrow-b">
                        <b>{b.blockNumber ? t('block', { n: b.blockNumber }) : t('newBlock')}</b>
                        <span className="spx-sub">{b.bundles.length} · {t('slabs', { n: b.bundles.reduce((s, x) => s + (Number(x.slabs) || 0), 0) })}</span>
                      </span>
                      <span className={`spx-chip is-${b.stage}`}>{t(`bs_${b.stage}` as StringKey)}</span>
                    </Link>
                  ))}
                </div>
              ) : <span className="spx-sub">{t('noBlocks')}</span>}
              {open ? (
                covered ? <span className="spx-chip is-approved spx-self-start">{t('lineCovered')}</span> : (
                  <button type="button" className="spx-btn is-gold" disabled={Boolean(starting)} onClick={() => offer(l.id)}>
                    <Plus size={18} aria-hidden="true" /> {starting === l.id ? t('sending') : t('offerBlock')}
                  </button>
                )
              ) : null}
            </section>
          );
        })}
      </main>
    </div>
  );
}
