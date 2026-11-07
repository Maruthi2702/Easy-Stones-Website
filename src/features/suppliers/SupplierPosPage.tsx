import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Factory, Plus, RefreshCw } from 'lucide-react';
import useIsPhone from '../../components/shared/form/useIsPhone';
import DashboardSearch from '../../components/shared/DashboardSearch';
import LocationFilter from '../../components/shared/LocationFilter';
import { FormPicker } from '../../components/shared/form/FormControls';
import RowMenu from '../../components/shared/RowMenu';
import Pagination from '../../components/shared/Pagination';
import { usePagination } from '../../components/shared/paginationConfig';
import { newVisitId } from '../../utils/visitForm';
import { PO_STAGES, type Step } from '../../utils/supplierBlocks';
import { can, SUPPLIER_POS } from '../../utils/supplierAccess';
import { useSupplierPos } from './useSupplierPos';
import * as api from './suppliersApi';
import { NO_FILTERS, poTiles, visibleBlocks, visiblePos, type PoFilters } from './supplierPosView';
import PoList from './components/PoList';
import BlockQueue from './components/BlockQueue';
import BlockReview from './components/BlockReview';
import PoDrawer from './components/PoDrawer';
import PoForm from './components/PoForm';
import PoStatusForm from './components/PoStatusForm';
import UnlockForm from './components/UnlockForm';
import BlockEntryForm from './components/BlockEntryForm';
import SuppliersPanel from './components/SuppliersPanel';
import type { Block, Po, SuppliersUser } from './types';
import '../../components/shared/form/FormModal.css';
import './SupplierPos.css';

export type SupplierPosPageProps = { currentUser: SuppliersUser | null; locations?: unknown[]; sidebarToggle?: ReactNode };

type Tab = 'pos' | 'review' | 'final' | 'suppliers';
type OpenBlock = { block: Block; from: Block[] | null };

/**
 * Purchasing → Supplier POs (2026-11-07). Design: the claude.ai artifact
 * "Supplier Portal Design". Purchasing adds a PO (typed, or filled from the
 * SPS import) and assigns it to a supplier; the supplier offers blocks on
 * their phone with a photo per bundle (src/features/supplierPortal/); step 1
 * reviews them bundle by bundle or the whole block, step 2 gives the final
 * approval, and only then may the supplier load. Suppliers and their logins
 * are the fourth tab. Rules: src/utils/supplierBlocks.ts.
 */
export default function SupplierPosPage({ currentUser, locations = [], sidebarToggle = null }: SupplierPosPageProps) {
  const isPhone = useIsPhone();
  const data = useSupplierPos(currentUser);
  const { meta } = data;
  const canManagePos = can(currentUser, SUPPLIER_POS.MANAGE_POS);
  const canReview = can(currentUser, SUPPLIER_POS.REVIEW);
  const canFinal = can(currentUser, SUPPLIER_POS.FINAL);
  const canUnlock = can(currentUser, SUPPLIER_POS.UNLOCK);
  const canManageSuppliers = can(currentUser, SUPPLIER_POS.MANAGE_SUPPLIERS);
  const [tab, setTab] = useState<Tab>('pos');
  const [filters, setFilters] = useState<PoFilters>(NO_FILTERS);
  const [openPo, setOpenPo] = useState<{ po: Po; loading: boolean } | null>(null);
  const [openBlock, setOpenBlock] = useState<OpenBlock | null>(null);
  const [poForm, setPoForm] = useState<{ po: Po | null } | null>(null);
  const [statusForm, setStatusForm] = useState<{ po: Po; status: Po['status'] } | null>(null);
  const [unlocking, setUnlocking] = useState<Block | null>(null);
  // Add block for the supplier / Enter what they sent (photos emailed or sent on WhatsApp).
  const [entry, setEntry] = useState<{ po: Po | null; block: Block | null } | null>(null);
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [toast, setToast] = useState('');
  const pager = usePagination();
  const { resetPage } = pager;

  const say = (text: string) => { setToast(text); window.setTimeout(() => setToast(''), 3200); };
  const patch = (p: Partial<PoFilters>) => setFilters((f) => ({ ...f, ...p }));
  useEffect(() => { resetPage(); }, [filters, tab, resetPage]);
  // A closed / cancelled stage needs every PO, not just the open ones.
  const { setScope } = data;
  useEffect(() => { setScope(['open', 'review', 'final', 'supplier', 'covered'].includes(filters.stage) ? 'open' : 'all'); }, [filters.stage, setScope]);

  // A link from an email (?block= / ?po=) opens it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const blockId = params.get('block');
    const poId = params.get('po');
    if (blockId) api.getBlock(blockId).then(({ block }) => setOpenBlock({ block, from: null })).catch((e: Error) => say(e.message));
    else if (poId) openPoById(poId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);
  const clearDeepLink = () => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('block') && !url.searchParams.has('po')) return;
    url.searchParams.delete('block'); url.searchParams.delete('po');
    window.history.replaceState(window.history.state, '', url);
  };

  const openPoById = async (id: string, list?: Po) => {
    setOpenPo(list ? { po: list, loading: true } : (prev) => prev);
    try {
      const { po } = await api.getPo(id);
      setOpenPo({ po, loading: false });
    } catch (e) {
      say((e as Error).message);
      setOpenPo(null);
    }
  };

  const { base, rows } = visiblePos(data.pos, filters);
  const paged = rows.slice((pager.currentPage - 1) * pager.rowsPerPage, pager.currentPage * pager.rowsPerPage);
  const reviewRows = visibleBlocks(data.review, filters);
  const finalRows = visibleBlocks(data.final, filters);
  const tiles = poTiles(data.pos, filters);
  const shipTos = useMemo(() => [...new Set(data.pos.map((p) => p.shipTo).filter(Boolean))], [data.pos]);
  const supplierOptions = data.suppliers.map((s) => ({ value: s.id, label: s.name }));
  const filtered = Boolean(filters.shipTo || filters.supplierId || (tab === 'pos' && filters.stage !== 'open'));
  const queueFor = (t: Tab) => (t === 'review' ? reviewRows : t === 'final' ? finalRows : null);

  // The queue's copy has no history: the full block replaces it as soon as it's read.
  const openBlockFull = (b: Block, from: Block[] | null) => {
    setOpenBlock({ block: b, from });
    api.getBlock(b.id).then(({ block }) => setOpenBlock((ob) => (block && ob && ob.block.id === block.id ? { ...ob, block } : ob))).catch(() => undefined);
  };
  const openFromQueue = (b: Block) => openBlockFull(b, queueFor(tab));
  const blockIndex = openBlock?.from ? openBlock.from.findIndex((b) => b.id === openBlock.block.id) : -1;

  const subtitle = tab === 'pos' ? `${tiles.open} open · ${tiles.approvedSlabs} of ${tiles.orderedSlabs} slabs approved`
    : tab === 'review' ? `${data.review.length} block${data.review.length === 1 ? '' : 's'} waiting for step 1`
    : tab === 'final' ? `${data.final.length} block${data.final.length === 1 ? '' : 's'} waiting for final approval`
    : `${data.suppliers.filter((s) => s.active).length} active suppliers`;

  const stageOptions = [
    { value: 'open', label: 'Every open PO' },
    ...PO_STAGES.map((s) => ({ value: s.key, label: s.label })),
    { value: 'all', label: 'Every PO' }
  ];
  const tabButton = (key: Tab, label: string, count?: number) => (
    <button type="button" role="tab" aria-selected={tab === key} className={`sp-tab${tab === key ? ' is-on' : ''}`} onClick={() => setTab(key)}>
      {label}{count ? <span className="sp-count">{count}</span> : null}
    </button>
  );

  return (
    <div className="sp">
      <div className="sp-page">
        <div className="sp-head">
          {sidebarToggle}
          <div className="sp-ttl">
            <h1>Supplier POs</h1>
            <span>{subtitle}</span>
          </div>
          <div className="sp-tools">
            <DashboardSearch value={filters.search} onChange={(search) => patch({ search })} label="Search supplier POs"
              placeholder={tab === 'suppliers' ? 'Search supplier, email' : 'Search PO #, supplier, material'}
              count={filters.search && tab === 'pos' ? `${rows.length} of ${base.length}` : null} />
            {tab !== 'suppliers' ? (
              <LocationFilter options={shipTos} value={filters.shipTo} onChange={(shipTo: string | string[]) => patch({ shipTo: String(shipTo || '') })}
                user={currentUser as never} active={filtered} wide allLabel="Every branch"
                onClear={() => setFilters((f) => ({ ...NO_FILTERS, search: f.search }))}>
                <div className="lf-group">
                  <label className="lf-group-label" htmlFor="sp-f-supplier">Supplier</label>
                  <FormPicker id="sp-f-supplier" value={filters.supplierId} onChange={(supplierId) => patch({ supplierId })} keepInForm sheetTitle="Supplier"
                    options={[{ value: '', label: 'Every supplier' }, ...supplierOptions]} />
                </div>
                {tab === 'pos' ? (
                  <div className="lf-group sp-filter-gap">
                    <label className="lf-group-label" htmlFor="sp-f-stage">Status</label>
                    <FormPicker id="sp-f-stage" value={filters.stage} onChange={(stage) => patch({ stage })} keepInForm sheetTitle="Status" options={stageOptions} />
                  </div>
                ) : null}
              </LocationFilter>
            ) : null}
            <RowMenu label="More" items={[{ key: 'reload', label: 'Refresh', icon: RefreshCw, onClick: () => { data.reload(); say('Refreshed'); } }]} />
          </div>
        </div>

        <div className="sp-tabs" role="tablist">
          {tabButton('pos', 'POs')}
          {tabButton('review', 'Waiting for review', data.review.length)}
          {tabButton('final', 'Final approval', data.final.length)}
          {tabButton('suppliers', 'Suppliers')}
        </div>

        {data.error ? <div className="sp-banner is-error" role="alert">{data.error}</div> : null}

        {tab === 'pos' ? (
          <>
            <div className="sp-tiles">
              <button type="button" className={`sp-tile${filters.stage === 'open' ? ' is-on' : ''}`} onClick={() => patch({ stage: 'open' })}>
                <span className="sp-tile-k">Open POs</span><span className="sp-tile-v">{tiles.open}</span><span className="sp-tile-c">{tiles.orderedSlabs} slabs ordered</span>
              </button>
              <button type="button" className="sp-tile" onClick={() => setTab('review')}>
                <span className="sp-tile-k"><span className="sp-dot is-wait" />Waiting for review</span><span className="sp-tile-v">{tiles.review}</span><span className="sp-tile-c">block{tiles.review === 1 ? '' : 's'} · step 1</span>
              </button>
              <button type="button" className="sp-tile" onClick={() => setTab('final')}>
                <span className="sp-tile-k"><span className="sp-dot is-final" />Final approval</span><span className="sp-tile-v">{tiles.final}</span><span className="sp-tile-c">block{tiles.final === 1 ? '' : 's'} · step 2</span>
              </button>
              <button type="button" className={`sp-tile${filters.stage === 'supplier' ? ' is-on' : ''}`} onClick={() => patch({ stage: 'supplier' })}>
                <span className="sp-tile-k"><span className="sp-dot is-draft" />Waiting for supplier</span><span className="sp-tile-v">{tiles.supplier}</span><span className="sp-tile-c">PO{tiles.supplier === 1 ? '' : 's'}</span>
              </button>
              <button type="button" className={`sp-tile is-total${filters.stage === 'covered' ? ' is-on' : ''}`} onClick={() => patch({ stage: 'covered' })}>
                <span className="sp-tile-k"><span className="sp-dot is-ok" />Approved to load</span><span className="sp-tile-v">{tiles.approvedSlabs}</span><span className="sp-tile-c">of {tiles.orderedSlabs} slabs on open POs</span>
              </button>
            </div>
            <div className={`sp-box${data.loading ? ' is-loading' : ''}`} aria-busy={data.loading}>
              {rows.length ? <PoList rows={paged} isPhone={isPhone} onOpen={(po) => openPoById(po.id, po)} /> : (
                <div className="sp-empty">
                  {data.loading ? <span>Loading…</span> : base.length || data.pos.length ? <><h3>Nothing matches</h3><span>Clear the search or the filters.</span></> : (
                    <>
                      <h3>No supplier POs yet</h3>
                      <span>Add a PO and assign it to a supplier. They see it in their portal and offer blocks with a photo of each bundle.</span>
                      {canManagePos ? <button type="button" className="sp-btn is-gold" onClick={() => setPoForm({ po: null })}><Plus size={16} /> New PO</button> : null}
                    </>
                  )}
                </div>
              )}
            </div>
            <Pagination currentPage={pager.currentPage} totalPages={Math.max(1, Math.ceil(rows.length / pager.rowsPerPage))}
              onPageChange={pager.setCurrentPage} rowsPerPage={pager.rowsPerPage} onRowsPerPageChange={pager.setRowsPerPage} totalCount={rows.length} />
          </>
        ) : tab === 'review' || tab === 'final' ? (
          <BlockQueue blocks={queueFor(tab)!} step={tab === 'review' ? 1 : 2} onOpen={openFromQueue}
            empty={<><h3>{tab === 'review' ? 'Nothing waiting for review' : 'Nothing waiting for final approval'}</h3><span>{tab === 'review' ? 'Blocks show here the moment a supplier sends them.' : 'Bundles show here once step 1 approves them.'}</span></>} />
        ) : meta ? (
          <SuppliersPanel suppliers={data.suppliers} meta={meta} search={filters.search} isPhone={isPhone} canManage={canManageSuppliers}
            adding={addingSupplier} onAdded={() => setAddingSupplier(false)} say={say}
            onChanged={(s) => data.setSuppliers((list) => (list.some((x) => x.id === s.id) ? list.map((x) => (x.id === s.id ? s : x)) : [...list, s].sort((a, b) => a.name.localeCompare(b.name))))} />
        ) : null}
      </div>

      {tab === 'suppliers' ? (
        canManageSuppliers ? <button type="button" className="sp-fab" aria-label="Add supplier" title="Add supplier" onClick={() => setAddingSupplier(true)}><Factory size={22} strokeWidth={2.2} /></button> : null
      ) : canManagePos && meta ? (
        <button type="button" className="sp-fab" aria-label="New PO" title="New PO" onClick={() => setPoForm({ po: null })}><Plus size={26} strokeWidth={2.4} /></button>
      ) : null}

      {openPo ? (
        <PoDrawer po={openPo.po} loading={openPo.loading} canManage={canManagePos}
          onEdit={() => setPoForm({ po: openPo.po })}
          onStatus={(status) => setStatusForm({ po: openPo.po, status })}
          onNotify={async () => {
            try { const { notified } = await api.notifyPo(openPo.po.id); say(`Emailed ${notified.emailed} login${notified.emailed === 1 ? '' : 's'}`); openPoById(openPo.po.id); } catch (e) { say((e as Error).message); }
          }}
          onOpenBlock={(b) => setOpenBlock({ block: b, from: openPo.po.blocks || null })}
          onAddBlock={canManagePos && meta ? () => setEntry({ po: openPo.po, block: null }) : undefined}
          onClose={() => { setOpenPo(null); clearDeepLink(); }} />
      ) : null}

      {openBlock && meta ? (
        <BlockReview
          block={openBlock.block}
          meta={meta}
          canReview={canReview}
          canFinal={canFinal}
          canUnlock={canUnlock}
          position={blockIndex >= 0 ? { index: blockIndex, count: openBlock.from!.length } : null}
          onStep={(by) => { const next = openBlock.from?.[blockIndex + by]; if (next) openBlockFull(next, openBlock.from); }}
          onDecide={async (step: Step, decisions, note) => {
            const r = await api.decide(openBlock.block.id, step, decisions, note);
            await data.placeBlock(r.block);
            if (openPo?.po.id === r.block.poId) openPoById(r.block.poId);
            const done = decisions.length;
            say(`${step === 1 ? 'Step 1' : 'Final approval'} saved for ${done} bundle${done === 1 ? '' : 's'}${r.emailed ? ' · the supplier was emailed' : ''}`);
            // On to the next block waiting in the same queue, else stay on this one.
            const from = openBlock.from;
            const rest = from ? from.filter((b) => b.id !== r.block.id) : [];
            const stillHere = r.block.bundles.some((x) => x.status === (step === 1 ? 'review' : 'final')) && r.block.decidable[step].length;
            if (from && !stillHere && rest.length) setOpenBlock({ block: rest[Math.min(Math.max(blockIndex, 0), rest.length - 1)]!, from: rest });
            else setOpenBlock({ block: r.block, from: from ? from.map((b) => (b.id === r.block.id ? r.block : b)) : null });
          }}
          onUnlock={() => setUnlocking(openBlock.block)}
          onEnter={canManagePos ? () => setEntry({ po: null, block: openBlock.block }) : undefined}
          onOpenPo={() => openPoById(openBlock.block.poId)}
          onClose={() => { setOpenBlock(null); clearDeepLink(); }}
        />
      ) : null}

      {poForm && meta ? (
        <PoForm po={poForm.po} meta={meta} suppliers={data.suppliers} locations={locations} user={currentUser}
          onClose={() => setPoForm(null)}
          onOpenExisting={(id) => { setPoForm(null); openPoById(id); }}
          onSave={async (body) => {
            const r = poForm.po ? await api.editPo(poForm.po.id, body) : await api.addPo(newVisitId(), body);
            data.placePo(r.po);
            setPoForm(null);
            if (openPo?.po.id === r.po.id || !poForm.po) setOpenPo({ po: r.po, loading: false });
            const sent = r.notified?.emailed ? ` · emailed to ${r.po.supplierName}` : '';
            say(poForm.po ? `PO saved${sent}` : `PO ${r.po.poNumber} assigned to ${r.po.supplierName}${sent}`);
          }} />
      ) : null}

      {statusForm ? (
        <PoStatusForm po={statusForm.po} status={statusForm.status} onClose={() => setStatusForm(null)}
          onSave={async (reason) => {
            const { po } = await api.setPoStatus(statusForm.po.id, statusForm.status, reason);
            data.placePo(po);
            setOpenPo({ po, loading: false });
            setStatusForm(null);
            say(statusForm.status === 'cancelled' ? 'PO cancelled' : statusForm.status === 'closed' ? 'PO closed' : 'PO reopened');
          }} />
      ) : null}

      {unlocking ? (
        <UnlockForm block={unlocking} onClose={() => setUnlocking(null)}
          onUnlock={async (ids, reason) => {
            const { block } = await api.unlock(unlocking.id, ids, reason);
            await data.placeBlock(block);
            setOpenBlock((ob) => (ob ? { ...ob, block } : ob));
            setUnlocking(null);
            say(`Unlocked · ${block.supplierName} was emailed`);
          }} />
      ) : null}

      {entry && meta ? (
        <BlockEntryForm po={entry.po} block={entry.block}
          supplier={data.suppliers.find((x) => x.id === (entry.po?.supplierId || entry.block?.supplierId)) || null}
          onClose={() => setEntry(null)}
          onSave={async (body, id) => {
            const { lineId, note, ...fields } = body;
            const { block } = entry.block
              ? await api.enterChanges(entry.block.id, entry.block.updatedAt, fields)
              : await api.enterBlock(entry.po!.id, id, { ...fields, lineId, note });
            await data.placeBlock(block);
            setEntry(null);
            setOpenBlock((ob) => (ob && ob.block.id === block.id ? { ...ob, block } : ob));
            if (openPo?.po.id === block.poId) openPoById(block.poId);
            const sent = block.bundles.filter((b) => b.status === 'review').length;
            say(`Block ${block.blockNumber} sent for review · ${sent} bundle${sent === 1 ? '' : 's'} for ${block.supplierName}`);
          }} />
      ) : null}

      {toast ? <div className="sp-toast" role="status">{toast}</div> : null}
    </div>
  );
}
