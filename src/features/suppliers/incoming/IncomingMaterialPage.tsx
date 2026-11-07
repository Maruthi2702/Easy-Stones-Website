import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import DashboardSearch from '../../../components/shared/DashboardSearch';
import LocationFilter from '../../../components/shared/LocationFilter';
import ImageGallery from '../../../components/shared/ImageGallery';
import { sizeText } from '../../../utils/supplierBlocks';
import { listIncoming } from '../suppliersApi';
import { dayText, timeAgo } from '../supplierPosView';
import type { IncomingItem, SuppliersUser } from '../types';
import '../SupplierPos.css';

/**
 * Products → Incoming Material (2026-11-07): what purchasing has approved
 * and the suppliers are loading — each block's approved bundles with their
 * photos, the material, thickness, finish, size and the branch it's going
 * to, so sales can show a customer what's coming. Never a price, the
 * supplier or the PO (owner, 2026-11-06); the server sends none of them.
 */
export default function IncomingMaterialPage({ currentUser, sidebarToggle = null }: { currentUser: SuppliersUser | null; sidebarToggle?: ReactNode }) {
  const [items, setItems] = useState<IncomingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [branch, setBranch] = useState('');
  const [gallery, setGallery] = useState<{ item: IncomingItem; index: number } | null>(null);

  useEffect(() => {
    let live = true;
    listIncoming().then((r) => { if (live) setItems(r.items); }).catch((e: Error) => { if (live) setError(e.message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  const branches = useMemo(() => [...new Set(items.map((i) => i.shipTo).filter(Boolean))], [items]);
  const q = search.trim().toLowerCase();
  const rows = items.filter((i) => (!branch || i.shipTo === branch) && (!q || `${i.material} ${i.thickness} ${i.finish} ${i.blockNumber}`.toLowerCase().includes(q)));
  const slabs = rows.reduce((s, i) => s + i.slabs, 0);
  const photos = gallery ? gallery.item.bundles.map((b) => b.photoUrl).filter(Boolean) : [];

  return (
    <div className="sp">
      <div className="sp-page">
        <div className="sp-head">
          {sidebarToggle}
          <div className="sp-ttl">
            <h1>Incoming Material</h1>
            <span>{rows.length} block{rows.length === 1 ? '' : 's'} · {slabs} slabs approved and on their way</span>
          </div>
          <div className="sp-tools">
            <DashboardSearch value={search} onChange={setSearch} label="Search incoming material" placeholder="Search material, block #"
              count={search ? `${rows.length} of ${items.length}` : null} />
            <LocationFilter options={branches} value={branch} onChange={(v: string | string[]) => setBranch(String(v || ''))} user={currentUser as never} allLabel="Every branch" />
          </div>
        </div>
        {error ? <div className="sp-banner is-error" role="alert">{error}</div> : null}
        {rows.length ? (
          <div className="sp-incoming">
            {rows.map((item) => (
              <article key={item.id} className="sp-inc">
                <div className="sp-inc-photos">
                  {item.bundles.slice(0, 4).map((b, i) => (
                    <button key={b.n} type="button" onClick={() => setGallery({ item, index: i })} aria-label={`Bundle ${b.n} photo, ${item.material}`}>
                      {b.photoUrl ? <img src={b.photoUrl} alt="" loading="lazy" /> : <span className="sp-qph" />}
                      {i === 3 && item.bundles.length > 4 ? <span className="sp-inc-more">+{item.bundles.length - 4}</span> : null}
                    </button>
                  ))}
                </div>
                <div className="sp-inc-body">
                  <b>{item.material}</b>
                  <span className="sp-sub is-13">{[item.thickness, item.finish].filter(Boolean).join(' · ')}{item.size ? ` · ${sizeText(item.size)}` : ''}</span>
                  <span>{item.slabs} slabs · {item.bundles.length} bundle{item.bundles.length === 1 ? '' : 's'} · block {item.blockNumber}</span>
                  <span className="sp-sub">To {item.shipTo}{item.readyBy ? ` · loading by ${dayText(item.readyBy)}` : ''} · approved {timeAgo(item.approvedAt)}</span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="sp-box"><div className="sp-empty">
            {loading ? <span>Loading…</span> : items.length ? <><h3>Nothing matches</h3><span>Clear the search or the branch.</span></> : <><h3>Nothing on its way yet</h3><span>Bundles show here once purchasing gives them final approval.</span></>}
          </div></div>
        )}
      </div>
      {gallery && photos.length ? (
        <ImageGallery image={photos[gallery.index]!} index={gallery.index} count={photos.length} images={photos}
          onPrev={() => setGallery((g) => (g ? { ...g, index: (g.index - 1 + photos.length) % photos.length } : g))}
          onNext={() => setGallery((g) => (g ? { ...g, index: (g.index + 1) % photos.length } : g))}
          onSelect={(index) => setGallery((g) => (g ? { ...g, index } : g))}
          onClose={() => setGallery(null)} />
      ) : null}
    </div>
  );
}
