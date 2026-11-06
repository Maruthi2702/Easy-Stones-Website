import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Camera, ChevronLeft, ChevronRight, Download, Info } from 'lucide-react';
import useIsPhone from '../../components/shared/form/useIsPhone';
import DashboardSearch from '../../components/shared/DashboardSearch';
import LocationFilter from '../../components/shared/LocationFilter';
import { FormPicker } from '../../components/shared/form/FormControls';
import RowMenu from '../../components/shared/RowMenu';
import Pagination from '../../components/shared/Pagination';
import { usePagination } from '../../components/shared/paginationConfig';
import { CARD_RECEIPTS, STATUSES, can, exportRows, formatMoney, holderMayEdit, monthLabel, shiftMonth, monthOf } from '../../utils/cardReceipts';
import { useCardReceipts } from './useCardReceipts';
import { NO_FILTERS, holdersOf, locationsOf, statusLine, visibleExpenses, type ReceiptFilters } from './cardReceiptsView';
import StatusTiles from './components/StatusTiles';
import ExpenseList from './components/ExpenseList';
import ExpenseDrawer from './components/ExpenseDrawer';
import ExpenseForm from './components/ExpenseForm';
import VoidExpenseForm from './components/VoidExpenseForm';
import CardsPanel from './components/CardsPanel';
import type { Expense, ReceiptsUser } from './types';
import './CardReceipts.css';

export type CardReceiptsPageProps = { currentUser: ReceiptsUser | null; sidebarToggle?: ReactNode };

type Tab = 'expenses' | 'waiting' | 'cards';
type Open = { kind: 'add'; lost?: boolean } | { kind: 'edit'; expense: Expense } | { kind: 'void'; expense: Expense } | null;

/**
 * Accounting → Credit Card Receipts (2026-11-05). Design: the claude.ai
 * artifacts "Credit Card Receipts Architecture" and "Credit Card Receipts UX".
 * Cardholders upload a receipt right after paying (the round gold +); someone
 * above them approves it (Waiting for me); accounting sees everyone's with
 * View all, manages the cards and exports the month. The Amex statement
 * check and reading receipts automatically come next.
 */
export default function CardReceiptsPage({ currentUser, sidebarToggle = null }: CardReceiptsPageProps) {
  const isPhone = useIsPhone();
  const data = useCardReceipts(currentUser);
  const { me } = data;
  const canUse = can(currentUser, CARD_RECEIPTS.USE);
  const canExport = can(currentUser, CARD_RECEIPTS.EXPORT);
  const canCards = can(currentUser, CARD_RECEIPTS.MANAGE_CARDS) || data.viewAll;
  const [tab, setTab] = useState<Tab>('expenses');
  const [filters, setFilters] = useState<ReceiptFilters>(NO_FILTERS);
  const [openId, setOpenId] = useState<string | null>(null);
  const [open, setOpen] = useState<Open>(null);
  const [toast, setToast] = useState('');
  const pager = usePagination();
  const categories = me?.categories || [];

  const source = tab === 'waiting' ? data.waiting : data.expenses;
  const { base, rows, totals, shown } = visibleExpenses(source, filters, categories);
  const paged = rows.slice((pager.currentPage - 1) * pager.rowsPerPage, pager.currentPage * pager.rowsPerPage);
  // Changing what's listed goes back to page 1.
  const { resetPage } = pager;
  useEffect(() => { resetPage(); }, [filters, tab, data.month, resetPage]);

  const opened = openId ? source.find((e) => e.id === openId) || data.expenses.find((e) => e.id === openId) || data.waiting.find((e) => e.id === openId) || null : null;
  const index = opened ? rows.findIndex((e) => e.id === opened.id) : -1;
  const todo = useMemo(() => data.expenses.filter((e) => e.mine && !e.voided && ['missing', 'draft', 'sent_back'].includes(e.status)), [data.expenses]);

  const say = (text: string) => { setToast(text); window.setTimeout(() => setToast(''), 2600); };
  const patchFilters = (patch: Partial<ReceiptFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const filtered = Boolean(filters.location || filters.holder || filters.category || filters.status !== 'all');

  const exportExcel = async () => {
    try {
      const XLSX = await import('xlsx');
      const ws = XLSX.utils.json_to_sheet(exportRows(rows, categories));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Card receipts');
      XLSX.writeFile(wb, `card-receipts-${tab === 'waiting' ? 'waiting' : data.month}.xlsx`);
    } catch (e) {
      say((e as Error).message || 'Could not build the file.');
    }
  };

  const subtitle = tab === 'waiting' ? `Waiting for me · ${data.waiting.length} · ${formatMoney(data.waiting.reduce((s, e) => s + e.cents, 0))}`
    : tab === 'cards' ? 'Company cards'
    : `${data.month ? monthLabel(data.month) : ''} · ${data.viewAll ? 'All cardholders' : me?.card ? `${me.card.label}${me.user.location ? ` · ${me.user.location}` : ''}` : 'Your receipts'}`;

  const holderOptions = holdersOf(source).map((h) => ({ value: h.id, label: h.name }));
  const categoryOptions = categories.map((c) => ({ value: c.name, label: c.label }));
  const statusOptions = STATUSES.map((s) => ({ value: s.key, label: s.label }));

  return (
    <div className="ccr">
      <div className="ccr-page">
        <div className="ccr-head">
          {sidebarToggle}
          <div className="ccr-ttl">
            <h1>{isPhone && !data.viewAll ? 'Card receipts' : 'Credit Card Receipts'}</h1>
            <span>{subtitle}</span>
          </div>
          {tab !== 'cards' ? (
            <div className="ccr-tools">
              <DashboardSearch value={filters.search} onChange={(search) => patchFilters({ search })} label="Search expenses"
                placeholder="Search merchant, cardholder, note" count={filters.search ? `${rows.length} of ${base.length}` : null} />
              <LocationFilter
                options={locationsOf(source)}
                value={filters.location}
                onChange={(location: string | string[]) => patchFilters({ location: String(location || '') })}
                user={currentUser}
                active={filtered}
                wide
                onClear={() => setFilters((f) => ({ ...NO_FILTERS, search: f.search }))}
              >
                {holderOptions.length > 1 ? (
                  <div className="lf-group">
                    <label className="lf-group-label" htmlFor="ccr-f-holder">Cardholder</label>
                    <FormPicker id="ccr-f-holder" value={filters.holder} onChange={(holder) => patchFilters({ holder })}
                      options={[{ value: '', label: 'Every cardholder' }, ...holderOptions]} sheetTitle="Cardholder" keepInForm />
                  </div>
                ) : null}
                <div className="lf-group ccr-filter-gap">
                  <label className="lf-group-label" htmlFor="ccr-f-category">Category</label>
                  <FormPicker id="ccr-f-category" value={filters.category} onChange={(category) => patchFilters({ category })}
                    options={[{ value: '', label: 'Every category' }, ...categoryOptions]} sheetTitle="Category" keepInForm />
                </div>
                <div className="lf-group ccr-filter-gap">
                  <label className="lf-group-label" htmlFor="ccr-f-status">Status</label>
                  <FormPicker id="ccr-f-status" value={filters.status} onChange={(status) => patchFilters({ status })}
                    options={[{ value: 'all', label: 'Every status' }, ...statusOptions]} sheetTitle="Status" keepInForm />
                </div>
              </LocationFilter>
              {canExport ? (
                <RowMenu label="More" items={[{ key: 'excel', label: 'Export this view to Excel', icon: Download, onClick: exportExcel }]} />
              ) : null}
            </div>
          ) : null}
        </div>

        {data.approver || canCards ? (
          <div className="ccr-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'expenses'} className={`ccr-tab${tab === 'expenses' ? ' is-on' : ''}`} onClick={() => setTab('expenses')}>
              {data.viewAll ? 'Expenses' : 'My expenses'}
            </button>
            {data.approver ? (
              <button type="button" role="tab" aria-selected={tab === 'waiting'} className={`ccr-tab${tab === 'waiting' ? ' is-on' : ''}`} onClick={() => setTab('waiting')}>
                Waiting for me {data.waiting.length ? <span className="ccr-count">{data.waiting.length}</span> : null}
              </button>
            ) : null}
            {canCards ? (
              <button type="button" role="tab" aria-selected={tab === 'cards'} className={`ccr-tab${tab === 'cards' ? ' is-on' : ''}`} onClick={() => setTab('cards')}>Cards</button>
            ) : null}
            {tab === 'expenses' && data.month ? <MonthStepper month={data.month} today={me?.today || ''} onMonth={data.setMonth} /> : null}
          </div>
        ) : data.month ? <div className="ccr-tabs"><MonthStepper month={data.month} today={me?.today || ''} onMonth={data.setMonth} /></div> : null}

        {data.error ? <div className="ccr-note is-error" role="alert">{data.error}</div> : null}
        {canUse && me && !me.card && tab === 'expenses' ? (
          <div className="ccr-note"><Info size={16} aria-hidden="true" /><span>You don’t have a company card set up yet. Ask accounting to add it, then you can upload receipts here.</span></div>
        ) : null}

        {tab === 'cards' ? (
          <CardsPanel canManage={can(currentUser, CARD_RECEIPTS.MANAGE_CARDS)} onSaved={say} />
        ) : (
          <>
            {isPhone && tab === 'expenses' && todo.length ? (
              <>
                <h2 className="ccr-todo-h">To do · {todo.length}</h2>
                {todo.map((e) => (
                  <button key={e.id} type="button" className={`ccr-todo${e.status === 'missing' ? ' is-miss' : ''}`} onClick={() => setOpenId(e.id)}>
                    <span className="ccr-todo-top"><b>{e.merchant}</b><span className="ccr-amt">{formatMoney(e.cents)}</span></span>
                    <span className="ccr-sub" style={{ fontSize: 13 }}>{statusLine(e, categories)}</span>
                  </button>
                ))}
              </>
            ) : null}

            {!isPhone && tab === 'expenses' ? <StatusTiles totals={totals} status={filters.status} onStatus={(status) => patchFilters({ status })}
              totalLabel={`Total for ${data.month ? monthLabel(data.month).split(' ')[0] : 'the month'}`} /> : null}
            {isPhone && tab === 'expenses' && todo.length && rows.length ? (
              <h2 className="ccr-todo-h" style={{ display: 'flex' }}>{data.month ? monthLabel(data.month).split(' ')[0] : ''}<span style={{ marginLeft: 'auto', textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>{formatMoney(shown.cents)} · {shown.count}</span></h2>
            ) : null}

            <div className={`ccr-box${data.loading ? ' is-loading' : ''}`} aria-busy={data.loading}>
              {rows.length ? (
                <ExpenseList rows={paged} isPhone={isPhone} categories={categories} showHolder={tab === 'waiting' || data.viewAll}
                  shownCents={shown.cents} shownCount={shown.count} onOpen={(e) => setOpenId(e.id)} />
              ) : (
                <div className="ccr-empty">
                  {data.loading ? <span>Loading…</span> : base.length ? (
                    <><h3>Nothing matches</h3><span>Clear the search or the filters.</span></>
                  ) : tab === 'waiting' ? (
                    <><h3>Nothing is waiting for you</h3><span>Receipts you approve show here once they’re sent.</span></>
                  ) : (
                    <>
                      <h3>No receipts for {data.month ? monthLabel(data.month) : 'this month'}</h3>
                      {canUse && me?.card ? <button type="button" className="ccr-btn gold" onClick={() => setOpen({ kind: 'add' })}><Camera size={16} aria-hidden="true" /> Add receipt</button> : null}
                    </>
                  )}
                </div>
              )}
            </div>
            <Pagination currentPage={pager.currentPage} totalPages={Math.max(1, Math.ceil(rows.length / pager.rowsPerPage))}
              onPageChange={pager.setCurrentPage} rowsPerPage={pager.rowsPerPage} onRowsPerPageChange={pager.setRowsPerPage} totalCount={rows.length} />
          </>
        )}
      </div>

      {canUse && me?.card ? (
        <button type="button" className="ccr-fab" aria-label="Add receipt" title="Add receipt" onClick={() => setOpen({ kind: 'add' })}>
          <Camera size={24} strokeWidth={2.2} aria-hidden="true" />
        </button>
      ) : null}

      {opened ? (
        <ExpenseDrawer
          expense={opened}
          categories={categories}
          position={index >= 0 ? { index, count: rows.length } : null}
          onStep={(by) => { const next = rows[index + by]; if (next) setOpenId(next.id); }}
          canEdit={opened.mine && canUse && holderMayEdit(opened)}
          onEdit={() => setOpen({ kind: 'edit', expense: opened })}
          onVoid={() => setOpen({ kind: 'void', expense: opened })}
          onApprove={async (comment) => {
            await data.approve(opened.id, comment);
            say('Approved');
            const next = tab === 'waiting' ? rows[index + 1] || rows[index - 1] : null;
            setOpenId(next && next.id !== opened.id ? next.id : null);
          }}
          onSendBack={async (comment) => { await data.sendBack(opened.id, comment); say('Sent back'); setOpenId(null); }}
          onClose={() => setOpenId(null)}
        />
      ) : null}

      {open?.kind === 'add' || open?.kind === 'edit' ? (
        <ExpenseForm
          expense={open.kind === 'edit' ? open.expense : null}
          startLost={open.kind === 'add' && Boolean(open.lost)}
          cardLabel={me?.card?.label || ''}
          holderName={me?.user.name || ''}
          categories={categories}
          today={me?.today || ''}
          upload={data.upload}
          onClose={() => setOpen(null)}
          onSave={async (body) => {
            const saved = open.kind === 'edit' ? await data.edit(open.expense.id, body) : await data.add(body);
            setOpen(null);
            if (monthOf(saved.date) !== data.month && tab === 'expenses') data.setMonth(monthOf(saved.date));
            say(saved.status === 'waiting' ? 'Sent for approval' : 'Saved as a draft');
          }}
        />
      ) : null}

      {open?.kind === 'void' ? (
        <VoidExpenseForm expense={open.expense} onClose={() => setOpen(null)}
          onVoid={async (reason) => { await data.voidOne(open.expense.id, reason); setOpen(null); setOpenId(null); say('Expense voided'); }} />
      ) : null}

      {toast ? <div className="ccr-toast" role="status">{toast}</div> : null}
    </div>
  );
}

/** ‹ October 2026 › — no month after this one. */
function MonthStepper({ month, today, onMonth }: { month: string; today: string; onMonth: (m: string) => void }) {
  const latest = today ? monthOf(today) : month;
  return (
    <div className="ccr-month">
      <button type="button" className="ccr-round is-small" aria-label="Previous month" onClick={() => onMonth(shiftMonth(month, -1))}><ChevronLeft size={16} /></button>
      <span>{monthLabel(month)}</span>
      <button type="button" className="ccr-round is-small" aria-label="Next month" disabled={month >= latest} onClick={() => onMonth(shiftMonth(month, 1))}><ChevronRight size={16} /></button>
    </div>
  );
}
