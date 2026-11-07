import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LogOut, RefreshCw, Search } from 'lucide-react';
import type { StringKey } from '../../../utils/supplierI18n';
import type { SupplierGroup } from '../../../utils/supplierBlocks';
import { listPos, signOut, type PortalError } from '../portalApi';
import { usePortal } from '../portalContext';
import { Bar, Loading, PortalHeader } from '../components';
import type { PortalPo } from '../types';

const GROUPS: { key: SupplierGroup; label: StringKey }[] = [
  { key: 'needs_you', label: 'needsYou' },
  { key: 'waiting', label: 'waiting' },
  { key: 'approved', label: 'approvedToLoad' },
  { key: 'closed', label: 'closed' }
];

/**
 * My POs (canvas "Supplier phone · My POs"): what needs them first, then what
 * waits for Easy Stones, what's approved to load, and what's closed. Each PO
 * shows its materials and how much is approved so far.
 */
export default function Home({ onSignedOut }: { onSignedOut: () => void }) {
  const { t, me, date } = usePortal();
  const [pos, setPos] = useState<PortalPo[] | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [showClosed, setShowClosed] = useState(false);

  const load = useCallback(() => listPos()
    .then((r) => { setPos(r.pos); setError(''); })
    .catch((e: PortalError) => {
      if (e.code === 'signin' || e.status === 401) onSignedOut(); else setError(t(e.code === 'offline' ? 'offline' : 'serverError'));
    }), [onSignedOut, t]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const again = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', again);
    return () => document.removeEventListener('visibilitychange', again);
  }, [load]);

  const q = search.trim().toLowerCase();
  const rows = (pos || []).filter((p) => !q || `${p.poNumber} ${p.lines.map((l) => l.material).join(' ')}`.toLowerCase().includes(q));

  return (
    <div className="spx-page">
      <PortalHeader title={t('myPos')} sub={me ? `${me.supplierName} · ${me.name}` : ''}
        right={<button type="button" className="spx-iconbtn" aria-label={t('signOut')} title={t('signOut')} onClick={async () => { await signOut().catch(() => undefined); onSignedOut(); }}><LogOut size={17} /></button>} />
      <main className="spx-main">
        <div className="spx-search">
          <Search size={17} aria-hidden="true" />
          <input className="spx-input no-capitalize" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('searchPos')} aria-label={t('searchPos')} />
          <button type="button" className="spx-iconbtn is-light" aria-label={t('refresh')} onClick={load}><RefreshCw size={16} /></button>
        </div>
        {error ? <div className="spx-error" role="alert">{error}</div> : null}
        {!pos ? <Loading /> : !pos.length ? <div className="spx-card"><p>{t('noPos')}</p></div> : !rows.length ? <div className="spx-card"><p>{t('nothingMatches')}</p></div> : null}
        {GROUPS.map((g) => {
          const list = rows.filter((p) => p.group === g.key);
          if (!list.length) return null;
          const collapsed = g.key === 'closed' && !showClosed && !q;
          return (
            <section key={g.key} className="spx-group">
              <h2 className={`spx-group-h is-${g.key}`}>
                {t(g.label)} <span>{list.length}</span>
                {g.key === 'closed' && !q ? <button type="button" className="spx-link" onClick={() => setShowClosed((v) => !v)}>{showClosed ? '−' : '+'}</button> : null}
              </h2>
              {collapsed ? null : list.map((po) => {
                const ordered = po.coverage.reduce((s, c) => s + c.ordered, 0);
                const approved = po.coverage.reduce((s, c) => s + c.approved, 0);
                const waiting = po.coverage.reduce((s, c) => s + c.review + c.final, 0);
                const retakes = po.blocks.reduce((s, b) => s + ('needs' in b ? Number(b.needs) || 0 : 0), 0);
                const drafts = po.blocks.filter((b) => b.stage === 'draft').length;
                const toOffer = po.coverage.reduce((s, c) => s + Math.max(0, c.ordered - c.approved - c.final - c.review), 0);
                const why = retakes ? `${retakes} ${t('countRetake')}` : drafts ? `${drafts} ${t('bs_draft').toLowerCase()}`
                  : po.group === 'needs_you' && toOffer ? t('toOffer', { n: toOffer }) : waiting ? `${waiting} ${t('countReview')}` : '';
                return (
                  <Link key={po.id} to={`/supplier/po/${po.id}`} className={`spx-po is-${po.group}`}>
                    <span className="spx-po-top"><b>{t('po', { n: po.poNumber })}</b>{po.readyBy ? <span className="spx-sub">{t('readyBy', { date: date(po.readyBy) })}</span> : null}</span>
                    <span className="spx-po-mat">{po.lines.map((l) => `${l.material}${l.thickness ? ` ${l.thickness}` : ''}`).join(' · ')}</span>
                    <Bar ordered={ordered} approved={approved} waiting={waiting} />
                    <span className="spx-sub">
                      {t('slabsApproved', { a: approved, n: ordered })}
                      {why ? <> · <b className={po.group === 'needs_you' ? 'spx-why' : ''}>{why}</b></> : null}
                    </span>
                  </Link>
                );
              })}
            </section>
          );
        })}
      </main>
    </div>
  );
}
