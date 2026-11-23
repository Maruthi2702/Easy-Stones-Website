import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Camera, ChevronLeft, ChevronRight, Download, Info } from 'lucide-react';
import useIsPhone from '../../components/shared/form/useIsPhone';
import DashboardSearch from '../../components/shared/DashboardSearch';
import LocationFilter from '../../components/shared/LocationFilter';
import { FormPicker } from '../../components/shared/form/FormControls';
import PeopleField from '../../components/shared/people/PeopleField';
import { useStaffList } from '../../api/salesRepOptions';
import usePeopleFilter from '../../components/shared/people/usePeopleFilter';
import RowMenu from '../../components/shared/RowMenu';
import Pagination from '../../components/shared/Pagination';
import { usePagination } from '../../components/shared/paginationConfig';
import { BANK_FILTERS, CARD_RECEIPTS, STATUSES, can, exportRows, formatMoney, holderMayEdit, monthLabel, shiftMonth, monthOf } from '../../utils/cardReceipts';
import { useCardReceipts } from './useCardReceipts';
import { listAllExpenses } from './cardReceiptsApi';
import { NO_FILTERS, holderPeople, statusLine, visibleExpenses, type ReceiptFilters } from './cardReceiptsView';
import StatusTiles from './components/StatusTiles';
import ExpenseList from './components/ExpenseList';
import ExpenseDrawer from './components/ExpenseDrawer';
import ExpenseForm from './components/ExpenseForm';
import AddReceiptChoice from './components/AddReceiptChoice';
import CameraCapture from './components/CameraCapture';
import VoidExpenseForm from './components/VoidExpenseForm';
import CardsPanel from './components/CardsPanel';
import StatementsPanel from './statements/StatementsPanel';
import type { Expense, ReceiptsUser } from './types';
import './CardReceipts.css';

export type CardReceiptsPageProps = { currentUser: ReceiptsUser | null; sidebarToggle?: ReactNode };

type Tab = 'expenses' | 'waiting' | 'statements' | 'cards';
type Open = { kind: 'choose' } | { kind: 'camera' } | { kind: 'add'; lost?: boolean; file?: File } | { kind: 'edit'; expense: Expense } | { kind: 'void'; expense: Expense } | null;

/**
 * Sales → Credit Card Receipts (2026-11-05). Design: the claude.ai
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
  const canExportAll = can(currentUser, CARD_RECEIPTS.EXPORT_ALL);
  const canCards = can(currentUser, CARD_RECEIPTS.MANAGE_CARDS) || can(currentUser, CARD_RECEIPTS.VIEW_ALL);
  const canStatements = can(currentUser, CARD_RECEIPTS.STATEMENTS);
  // Someone who only runs the Amex check opens on it.
  const [tab, setTab] = useState<Tab>(() => ([CARD_RECEIPTS.USE, CARD_RECEIPTS.VIEW_ALL, CARD_RECEIPTS.APPROVE].some((p) => can(currentUser, p)) || !can(currentUser, CARD_RECEIPTS.STATEMENTS) ? 'expenses' : 'statements'));
  const [filters, setFilters] = useState<ReceiptFilters>(NO_FILTERS);
  const [openId, setOpenId] = useState<string | null>(null);
  const [open, setOpen] = useState<Open>(null);
  const [toast, setToast] = useState('');
  const pager = usePagination();
  const categories = me?.categories || [];

  const source = tab === 'waiting' ? data.waiting : data.expenses;
  // One People filter for cardholder and branch (the shared one): only who this login may see.
  const staff = useStaffList();
  const viewerId = String(me?.user.id || currentUser?.id || currentUser?._id || '');
  const people = useMemo(() => holderPeople(source, staff, currentUser, data.holders), [source, staff, currentUser, data.holders]);
  // "Me" only when the viewer is one of the cardholders listed.
  const meId = people.some((p) => p.value === viewerId) ? viewerId : '';
  const peopleFilter = usePeopleFilter({
    options: people, me: meId, start: 'team', label: 'Cardholder',
    teamLabel: data.teamOnly ? 'My team' : 'All cardholders', hideMe: !meId
  });
  const receiptFilters = useMemo(() => ({ ...filters, people: peopleFilter.value }), [filters, peopleFilter.value]);
  const { base, rows, totals, shown } = visibleExpenses(source, receiptFilters, categories);
  const paged = rows.slice((pager.currentPage - 1) * pager.rowsPerPage, pager.currentPage * pager.rowsPerPage);
  // Changing what's listed goes back to page 1.
  const { resetPage } = pager;
  useEffect(() => { resetPage(); }, [receiptFilters, tab, data.month, resetPage]);

  const opened = openId ? source.find((e) => e.id === openId) || data.expenses.find((e) => e.id === openId) || data.waiting.find((e) => e.id === openId) || null : null;
  const index = opened ? rows.findIndex((e) => e.id === opened.id) : -1;
  const todo = useMemo(() => data.expenses.filter((e) => e.mine && !e.voided && ['missing', 'draft', 'sent_back'].includes(e.status)), [data.expenses]);

  const say = (text: string) => { setToast(text); window.setTimeout(() => setToast(''), 2600); };
  const patchFilters = (patch: Partial<ReceiptFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const filtered = Boolean(peopleFilter.active || filters.category || filters.bank || filters.status !== 'all');

  const bankName = BANK_FILTERS.find((b) => b.key === filters.bank)?.label || '';
  const bankSuffix = filters.bank ? `-${filters.bank}` : '';
  /** A private receipt's link is this site's own address: it opens only for someone signed in who may see it. */
  const writeExcel = async (list: Expense[], file: string) => {
    const XLSX = await import('xlsx');
    const withSite = (u: string) => (u.startsWith('/') ? `${window.location.origin}${u}` : u);
    const ws = XLSX.utils.json_to_sheet(exportRows(list.map((e) => ({ ...e, receiptUrl: e.receiptUrl ? withSite(e.receiptUrl) : e.receiptUrl })), categories));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Card receipts');
    XLSX.writeFile(wb, file);
  };
  // The list on screen: the month and every filter, the Card (bank) one included.
  const exportExcel = async () => {
    try {
      await writeExcel(rows, `card-receipts-${tab === 'waiting' ? 'waiting' : data.month}${bankSuffix}.xlsx`);
    } catch (e) {
      say((e as Error).message || 'Could not build the file.');
    }
  };
  // Every month for the bank picked (or both): the server answers only with the Export all switch.
  const exportAll = async () => {
    try {
      say('Getting every month…');
      const res = await listAllExpenses(filters.bank);
      await writeExcel(res.expenses, `card-receipts-all${bankSuffix}.xlsx`);
      say(res.truncated ? 'Too many to list: the file holds the newest ones only.' : `Downloaded ${res.expenses.filter((e) => !e.voided).length} expenses`);
    } catch (e) {
      say((e as Error).message || 'Could not build the file.');
    }
  };
  const exportItems = [
    ...(canExport ? [{ key: 'excel', label: bankName ? `Export this view (${bankName}) to Excel` : 'Export this view to Excel', icon: Download, onClick: exportExcel }] : []),
    ...(canExportAll ? [{ key: 'excel-all', label: bankName ? `Export all months (${bankName})` : 'Export all months (Amex and Encore)', icon: Download, onClick: exportAll }] : [])
  ];

  const subtitle = tab === 'waiting' ? `Waiting for me · ${data.waiting.length} · ${formatMoney(data.waiting.reduce((s, e) => s + e.cents, 0))}`
    : tab === 'cards' ? 'Company cards'
    : tab === 'statements' ? 'Amex check · every charge against an uploaded receipt'
    : `${data.month ? monthLabel(data.month) : ''} · ${data.viewAll ? (data.teamOnly ? 'Your team' : 'All cardholders') : me?.card ? `${me.card.label}${me.user.location ? ` · ${me.user.location}` : ''}` : 'Your receipts'}`;

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
          {tab !== 'cards' && tab !== 'statements' ? (
            <div className="ccr-tools">
              <DashboardSearch value={filters.search} onChange={(search) => patchFilters({ search })} label="Search expenses"
                placeholder="Search merchant, cardholder, note" count={filters.search ? `${rows.length} of ${base.length}` : null} />
              <LocationFilter
                options={[]}
                value=""
                onChange={() => {}}
                user={currentUser}
                active={filtered}
                wide
                onClear={() => { setFilters((f) => ({ ...NO_FILTERS, search: f.search })); peopleFilter.reset(); }}
              >
                {people.length > 1 ? (
                  <PeopleField {...peopleFilter.field} />
                ) : null}
                <div className="lf-group ccr-filter-gap">
                  <label className="lf-group-label" htmlFor="ccr-f-category">Category</label>
                  <FormPicker id="ccr-f-category" value={filters.category} onChange={(category) => patchFilters({ category })}
                    options={[{ value: '', label: 'Every category' }, ...categoryOptions]} sheetTitle="Category" keepInForm />
                </div>
                {data.viewAll || canExport || canExportAll ? (
                  <div className="lf-group ccr-filter-gap">
                    <label className="lf-group-label" htmlFor="ccr-f-bank">Card</label>
                    <FormPicker id="ccr-f-bank" value={filters.bank} onChange={(bank) => patchFilters({ bank })}
                      options={[{ value: '', label: 'Amex and Encore' }, ...BANK_FILTERS.map((b) => ({ value: b.key, label: b.label }))]} sheetTitle="Card" keepInForm />
                  </div>
                ) : null}
                <div className="lf-group ccr-filter-gap">
                  <label className="lf-group-label" htmlFor="ccr-f-status">Status</label>
                  <FormPicker id="ccr-f-status" value={filters.status} onChange={(status) => patchFilters({ status })}
                    options={[{ value: 'all', label: 'Every status' }, ...statusOptions]} sheetTitle="Status" keepInForm />
                </div>
              </LocationFilter>
              {exportItems.length ? <RowMenu label="More" items={exportItems} /> : null}
            </div>
          ) : null}
        </div>

        {data.approver || canCards || canStatements ? (
          <div className="ccr-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'expenses'} className={`ccr-tab${tab === 'expenses' ? ' is-on' : ''}`} onClick={() => setTab('expenses')}>
              {data.viewAll ? 'Expenses' : 'My expenses'}
            </button>
            {data.approver ? (
              <button type="button" role="tab" aria-selected={tab === 'waiting'} className={`ccr-tab${tab === 'waiting' ? ' is-on' : ''}`} onClick={() => setTab('waiting')}>
                Waiting for me {data.waiting.length ? <span className="ccr-count">{data.waiting.length}</span> : null}
              </button>
            ) : null}
            {canStatements ? (
              <button type="button" role="tab" aria-selected={tab === 'statements'} className={`ccr-tab${tab === 'statements' ? ' is-on' : ''}`} onClick={() => setTab('statements')}>Statements</button>
            ) : null}
            {canCards ? (
              <button type="button" role="tab" aria-selected={tab === 'cards'} className={`ccr-tab${tab === 'cards' ? ' is-on' : ''}`} onClick={() => setTab('cards')}>Cards</button>
            ) : null}
            {(tab === 'expenses' || tab === 'statements') && data.month ? <MonthStepper month={data.month} today={me?.today || ''} onMonth={data.setMonth} /> : null}
          </div>
        ) : data.month ? <div className="ccr-tabs"><MonthStepper month={data.month} today={me?.today || ''} onMonth={data.setMonth} /></div> : null}

        {data.error ? <div className="ccr-note is-error" role="alert">{data.error}</div> : null}
        {tab === 'waiting' && data.waitingError ? (
          <div className="ccr-note is-error" role="alert"><span>{data.waitingError}</span> <button type="button" className="ccr-btn" onClick={data.reload}>Try again</button></div>
        ) : null}
        {canUse && me && !me.card && tab === 'expenses' ? (
          <div className="ccr-note"><Info size={16} aria-hidden="true" /><span>You don’t have a company card set up yet. Ask accounting to add it, then you can upload receipts here.</span></div>
        ) : null}

        {tab === 'cards' ? (
          <CardsPanel canManage={can(currentUser, CARD_RECEIPTS.MANAGE_CARDS)} canSetUp={canStatements} month={data.month || ''} onSaved={say} />
        ) : tab === 'statements' ? (
          data.month ? <StatementsPanel month={data.month} isPhone={isPhone} canCards={canCards} onOpenCards={() => setTab('cards')}
            onSaved={(text) => { say(text); data.reload(); }} /> : null
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
                  {data.loading ? <span>Loading…</span> : tab === 'waiting' && data.waitingError ? (
                    <span>The receipts waiting for you couldn’t be loaded.</span>
                  ) : base.length ? (
                    <><h3>Nothing matches</h3><span>Clear the search or the filters.</span></>
                  ) : tab === 'waiting' ? (
                    <><h3>Nothing is waiting for you</h3><span>Receipts you approve show here once they’re sent.</span></>
                  ) : (
                    <>
                      <h3>No receipts for {data.month ? monthLabel(data.month) : 'this month'}</h3>
                      {canUse && me?.card ? <button type="button" className="ccr-btn gold" onClick={() => setOpen({ kind: 'choose' })}><Camera size={16} aria-hidden="true" /> Add receipt</button> : null}
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
        <button type="button" className="ccr-fab" aria-label="Add receipt" title="Add receipt" onClick={() => setOpen({ kind: 'choose' })}>
          <Camera size={24} strokeWidth={2.2} aria-hidden="true" />
        </button>
      ) : null}

      {opened ? (
        <ExpenseDrawer
          expense={opened}
          categories={categories}
          canEdit={opened.mine && canUse && holderMayEdit(opened)}
          onEdit={() => setOpen({ kind: 'edit', expense: opened })}
          onVoid={() => setOpen({ kind: 'void', expense: opened })}
          onApprove={async (comment) => {
            try { await data.approve(opened.id, comment, opened.updatedAt); } catch (e) { data.reload(); throw e; }
            say('Approved');
            const next = tab === 'waiting' ? rows[index + 1] || rows[index - 1] : null;
            setOpenId(next && next.id !== opened.id ? next.id : null);
          }}
          onSendBack={async (comment) => { try { await data.sendBack(opened.id, comment, opened.updatedAt); } catch (e) { data.reload(); throw e; } say('Sent back'); setOpenId(null); }}
          onClose={() => setOpenId(null)}
        />
      ) : null}

      {open?.kind === 'choose' ? (
        <AddReceiptChoice
          onClose={() => setOpen(null)}
          onCamera={() => setOpen({ kind: 'camera' })}
          onLost={() => setOpen({ kind: 'add', lost: true })}
          onFile={(file) => setOpen({ kind: 'add', file })}
        />
      ) : null}

      {open?.kind === 'camera' ? (
        <CameraCapture onClose={() => setOpen({ kind: 'choose' })} onFile={(file) => setOpen({ kind: 'add', file })} />
      ) : null}

      {open?.kind === 'add' || open?.kind === 'edit' ? (
        <ExpenseForm
          expense={open.kind === 'edit' ? open.expense : null}
          startLost={open.kind === 'add' && Boolean(open.lost)}
          initialFile={open.kind === 'add' ? open.file : null}
          cardLabel={me?.card?.label || ''}
          holderName={me?.user.name || ''}
          categories={categories}
          today={me?.today || ''}
          upload={data.upload}
          scan={data.scan}
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
