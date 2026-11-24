import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, Camera, ChevronLeft, ChevronRight, Download, Info } from 'lucide-react';
import useIsPhone from '../../components/shared/form/useIsPhone';
import DashboardSearch from '../../components/shared/DashboardSearch';
import LocationFilter from '../../components/shared/LocationFilter';
import { FormPicker, SegmentedToggle } from '../../components/shared/form/FormControls';
import PeopleField from '../../components/shared/people/PeopleField';
import { useStaffList } from '../../api/salesRepOptions';
import usePeopleFilter from '../../components/shared/people/usePeopleFilter';
import RowMenu from '../../components/shared/RowMenu';
import Pagination from '../../components/shared/Pagination';
import { usePagination } from '../../components/shared/paginationConfig';
import { BANK_FILTERS, CARD_RECEIPTS, STATUSES, can, formatMoney, holderMayEdit, anyoneMayEdit, onBank, monthLabel, shiftMonth, monthOf, usDate } from '../../utils/cardReceipts';
import { useCardReceipts } from './useCardReceipts';
import { getAddForHolders, listAllExpenses } from './cardReceiptsApi';
import { exportFileName, exportScope, type ExportChoice } from '../../utils/cardReceiptsExport';
import { writeExcel, writePdf } from './exportFiles';
import { NO_FILTERS, TODO_SHOWN, WAIT_FILTERS, byWaitFilter, holderPeople, remindable, statusLine, visibleExpenses, waitCounts, type ReceiptFilters, type WaitFilter } from './cardReceiptsView';
import StatusTiles from './components/StatusTiles';
import ExpenseList, { type ListSelection } from './components/ExpenseList';
import ExpenseDrawer from './components/ExpenseDrawer';
import AskForm from './components/AskForm';
import ReopenForm from './components/ReopenForm';
import RemindDialog from './components/RemindDialog';
import ExpenseForm from './components/ExpenseForm';
import AddReceiptChoice from './components/AddReceiptChoice';
import ExportDialog from './components/ExportDialog';
import CameraCapture from './components/CameraCapture';
import VoidExpenseForm from './components/VoidExpenseForm';
import DeleteExpenseForm from './components/DeleteExpenseForm';
import CardsPanel from './components/CardsPanel';
import StatementsPanel from './statements/StatementsPanel';
import type { AddableHolder, Expense, ReceiptsUser } from './types';
import './CardReceipts.css';

export type CardReceiptsPageProps = { currentUser: ReceiptsUser | null; sidebarToggle?: ReactNode };

type Tab = 'expenses' | 'waiting' | 'statements' | 'cards';
type Open = { kind: 'choose' } | { kind: 'export' } | { kind: 'camera' } | { kind: 'add'; lost?: boolean; file?: File } | { kind: 'edit'; expense: Expense } | { kind: 'void'; expense: Expense } | { kind: 'delete'; expense: Expense }
  | { kind: 'ask'; expense: Expense } | { kind: 'reopen'; expense: Expense } | { kind: 'remind'; expenses: Expense[] } | null;

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
  const canRemind = can(currentUser, CARD_RECEIPTS.REMIND);
  const canAddForOthers = can(currentUser, CARD_RECEIPTS.ADD_FOR_OTHERS);
  // Accounting's switches (2026-11-24): change or void anyone's receipt, approved ones too; admins delete.
  const canEditAny = can(currentUser, CARD_RECEIPTS.EDIT_ANY);
  const canVoidAny = can(currentUser, CARD_RECEIPTS.VOID_ANY);
  const canDelete = can(currentUser, CARD_RECEIPTS.DELETE);
  const [addHolders, setAddHolders] = useState<AddableHolder[]>([]);
  useEffect(() => {
    if (!canAddForOthers) return;
    let live = true;
    getAddForHolders().then((r) => { if (live) setAddHolders(r.holders); }).catch(() => { /* the form still adds your own */ });
    return () => { live = false; };
  }, [canAddForOthers]);
  const canAdd = (canUse && Boolean(me?.card)) || (canAddForOthers && addHolders.length > 0);
  // Someone who only runs the Amex check opens on it.
  const [tab, setTab] = useState<Tab>(() => ([CARD_RECEIPTS.USE, CARD_RECEIPTS.VIEW_ALL, CARD_RECEIPTS.APPROVE].some((p) => can(currentUser, p)) || !can(currentUser, CARD_RECEIPTS.STATEMENTS) ? 'expenses' : 'statements'));
  const [filters, setFilters] = useState<ReceiptFilters>(NO_FILTERS);
  const [waitFilter, setWaitFilter] = useState<WaitFilter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [open, setOpen] = useState<Open>(null);
  const [toast, setToast] = useState('');
  // Receipts ticked for Send reminder… (and a phone's Select mode).
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [selecting, setSelecting] = useState(false);
  const pager = usePagination();
  const categories = me?.categories || [];
  // Waiting for me: approvers always; anyone else while a question is asked of them.
  const showWaiting = data.approver || data.waiting.length > 0 || tab === 'waiting';
  const waitN = useMemo(() => waitCounts(data.waiting), [data.waiting]);

  const source = tab === 'waiting' ? byWaitFilter(data.waiting, waitFilter) : data.expenses;
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
  // What each Filters choice would show with the others as they are now: the number beside it.
  const counts = useMemo(() => {
    const n = (patch: Partial<ReceiptFilters>) => visibleExpenses(source, { ...receiptFilters, ...patch }, categories).rows.length;
    return {
      status: Object.fromEntries([['all', n({ status: 'all' })], ...STATUSES.map((s) => [s.key, n({ status: s.key })])]) as Record<string, number>,
      bank: Object.fromEntries([['', n({ bank: '' })], ...BANK_FILTERS.map((b) => [b.key, n({ bank: b.key })])]) as Record<string, number>,
      category: Object.fromEntries([['', n({ category: '' })], ...categories.map((c) => [c.name, n({ category: c.name })])]) as Record<string, number>
    };
  }, [source, receiptFilters, categories]);
  const paged = rows.slice((pager.currentPage - 1) * pager.rowsPerPage, pager.currentPage * pager.rowsPerPage);
  // Changing what's listed goes back to page 1.
  const { resetPage } = pager;
  useEffect(() => { resetPage(); }, [receiptFilters, tab, data.month, waitFilter, resetPage]);
  // Another tab or month starts with nothing ticked.
  useEffect(() => { setSelected(new Set()); setSelecting(false); }, [tab, data.month]);

  // What "Select all shown" ticks: every row the filters show (not just this page) that a reminder can go about.
  const remindRows = canRemind && (tab === 'expenses' || tab === 'waiting') ? rows.filter(remindable) : [];
  const ticked = remindRows.filter((e) => selected.has(e.id));
  const allShown = remindRows.length > 0 && ticked.length === remindRows.length;
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSelected(allShown ? new Set() : new Set(remindRows.map((e) => e.id)));
  const clearSelection = () => { setSelected(new Set()); setSelecting(false); };
  const selection: ListSelection | null = remindRows.length && (!isPhone || selecting)
    ? { selected, onToggle: toggle, allShown, onToggleAll: toggleAll, active: selecting }
    : null;

  const opened = openId ? source.find((e) => e.id === openId) || data.expenses.find((e) => e.id === openId) || data.waiting.find((e) => e.id === openId)
    || data.todo.find((e) => e.id === openId) || null : null;
  const index = opened ? rows.findIndex((e) => e.id === opened.id) : -1;
  // To do (review B1): every month's, from the server — a charge from last month found by this month's statement shows too.
  const todo = data.todo;
  const missingMine = todo.filter((e) => e.status === 'missing');
  const [allTodo, setAllTodo] = useState(false);
  const todoShown = allTodo ? todo : todo.slice(0, TODO_SHOWN);

  /** After a decision from Waiting for me, the next one opens; otherwise the drawer closes. */
  const openNext = (id: string) => {
    const next = tab === 'waiting' ? rows[index + 1] || rows[index - 1] : null;
    setOpenId(next && next.id !== id ? next.id : null);
  };

  const say = (text: string) => { setToast(text); window.setTimeout(() => setToast(''), 2600); };
  const patchFilters = (patch: Partial<ReceiptFilters>) => setFilters((f) => ({ ...f, ...patch }));
  // Waiting for me's queue (Needs Accounting / second approval / Asked of me) is a Filters field, only for approvers.
  const queueField = tab === 'waiting' && data.approver;
  const queueActive = queueField && waitFilter !== 'all';
  const filtered = Boolean(peopleFilter.active || filters.category || filters.bank || filters.status !== 'all' || queueActive);

  // Export…: one pop-up (Card, Months, Format). "This month" is that month's receipts for the bank picked,
  // whatever the other filters say; "All months" asks the server and needs the Export all switch.
  // A failure is thrown back to the pop-up, which stays open and says so.
  const runExport = async (c: ExportChoice) => {
    const file = exportFileName(c, data.month || '');
    if (c.months === 'all') {
      say('Getting every month…');
      const res = await listAllExpenses(c.bank);
      await writeExcel(res.expenses, categories, file);
      say(res.truncated ? 'Too many to list: the file holds the newest ones only.' : `Downloaded ${res.expenses.filter((e) => !e.voided).length} expenses`);
      return;
    }
    const list = data.expenses.filter((e) => !e.voided && onBank(e, c.bank));
    if (c.format === 'pdf') await writePdf(list, categories, exportScope(c, data.month ? monthLabel(data.month) : ''), file);
    else await writeExcel(list, categories, file);
    say(`Downloaded ${list.length} expenses`);
  };
  const exportItems = canExport || canExportAll
    ? [{ key: 'export', label: 'Export…', icon: Download, onClick: () => setOpen({ kind: 'export' }) }]
    : [];

  const subtitle = tab === 'waiting' ? `Waiting for me · ${data.waiting.length} · ${formatMoney(data.waiting.reduce((s, e) => s + e.cents, 0))}`
    : tab === 'cards' ? 'Company cards'
    : tab === 'statements' ? 'Amex check · every charge against an uploaded receipt'
    : `${data.month ? monthLabel(data.month) : ''} · ${data.viewAll ? (data.teamOnly ? 'Your team' : 'All cardholders') : me?.card ? `${me.card.label}${me.user.location ? ` · ${me.user.location}` : ''}` : 'Your receipts'}`;

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
                onClear={() => { setFilters((f) => ({ ...NO_FILTERS, search: f.search })); peopleFilter.reset(); setWaitFilter('all'); }}
                activeCount={(queueActive ? 1 : 0) + (peopleFilter.active ? 1 : 0) + (filters.category ? 1 : 0) + (filters.bank ? 1 : 0) + (filters.status !== 'all' ? 1 : 0)}
                doneLabel={rows.length ? `Show ${rows.length} receipt${rows.length === 1 ? '' : 's'}` : 'No receipts match'}
              >
                {/* Card, Status, Category, Cardholder — each choice says how many receipts it would show
                    given the others (the Follow-ups panel's "Label · 3" format). */}
                <div className="fm-tokens ccr-fields">
                  {queueField ? (
                    <div className="lf-group">
                      <label className="lf-group-label" htmlFor="ccr-f-queue">Queue</label>
                      <FormPicker id="ccr-f-queue" value={waitFilter} onChange={(v) => setWaitFilter(v as WaitFilter)}
                        options={WAIT_FILTERS.map((f) => ({ value: f.key, label: `${f.label} · ${waitN[f.key]}` }))}
                        sheetTitle="Queue" keepInForm />
                    </div>
                  ) : null}
                  {data.viewAll || canExport || canExportAll ? (
                    <div className="lf-group" role="group" aria-labelledby="ccr-f-bank">
                      <span className="lf-group-label" id="ccr-f-bank">Card</span>
                      <SegmentedToggle<string>
                        label="Card"
                        value={filters.bank}
                        onChange={(bank) => patchFilters({ bank })}
                        options={[{ value: '', label: `All · ${counts.bank['']}` }, ...BANK_FILTERS.map((b) => ({ value: b.key, label: `${b.label} · ${counts.bank[b.key]}` }))]}
                      />
                    </div>
                  ) : null}
                  <div className="lf-group">
                    <label className="lf-group-label" htmlFor="ccr-f-status">Status</label>
                    <FormPicker id="ccr-f-status" value={filters.status} onChange={(status) => patchFilters({ status })}
                      options={[{ value: 'all', label: `Every status · ${counts.status.all}` }, ...STATUSES.map((s) => ({ value: s.key, label: `${s.label} · ${counts.status[s.key]}` }))]}
                      sheetTitle="Status" keepInForm />
                  </div>
                  <div className="lf-group">
                    <label className="lf-group-label" htmlFor="ccr-f-category">Category</label>
                    <FormPicker id="ccr-f-category" value={filters.category} onChange={(category) => patchFilters({ category })}
                      options={[{ value: '', label: `Every category · ${counts.category['']}` }, ...categories.map((c) => ({ value: c.name, label: `${c.label} · ${counts.category[c.name] ?? 0}` }))]}
                      sheetTitle="Category" keepInForm />
                  </div>
                  {people.length > 1 ? <PeopleField {...peopleFilter.field} /> : null}
                </div>
              </LocationFilter>
              {exportItems.length ? <RowMenu label="More" items={exportItems} /> : null}
            </div>
          ) : null}
        </div>

        {showWaiting || canCards || canStatements ? (
          <div className="ccr-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'expenses'} className={`ccr-tab${tab === 'expenses' ? ' is-on' : ''}`} onClick={() => setTab('expenses')}>
              {data.viewAll ? 'Expenses' : 'My expenses'}
            </button>
            {showWaiting ? (
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
            {tab === 'expenses' && missingMine.length ? (
              <div className="ccr-note is-warn ccr-banner" role="status">
                <AlertTriangle size={16} aria-hidden="true" />
                <span>
                  You have {missingMine.length} missing {missingMine.length === 1 ? 'receipt' : 'receipts'}
                  {missingMine.some((e) => monthOf(e.date) !== data.month) ? ' (some from another month)' : ''} — upload {missingMine.length === 1 ? 'it' : 'them'}.
                </span>
                <button type="button" className="ccr-btn ccr-banner-btn" onClick={() => setOpenId(missingMine[missingMine.length - 1].id)}>
                  Upload
                </button>
              </div>
            ) : null}

            {tab === 'expenses' && todo.length ? (
              <section className="ccr-todos" aria-label="To do">
                <h2 className="ccr-todo-h">To do · {todo.length}</h2>
                <div className="ccr-todo-grid">
                  {todoShown.map((e) => (
                    <button key={e.id} type="button" className={`ccr-todo${e.status === 'missing' ? ' is-miss' : ''}`} onClick={() => setOpenId(e.id)}>
                      <span className="ccr-todo-top"><b>{e.merchant}</b><span className="ccr-amt">{formatMoney(e.cents)}</span></span>
                      <span className="ccr-sub" style={{ fontSize: 13 }}>{usDate(e.date)} · {statusLine(e, categories)}</span>
                    </button>
                  ))}
                </div>
                {todo.length > TODO_SHOWN ? (
                  <button type="button" className="ccr-btn ccr-todo-more" onClick={() => setAllTodo((a) => !a)}>
                    {allTodo ? 'Show fewer' : `Show all ${todo.length}`}
                  </button>
                ) : null}
              </section>
            ) : null}

            {!isPhone && tab === 'expenses' ? <StatusTiles totals={totals} status={filters.status} onStatus={(status) => patchFilters({ status })}
              totalLabel={`Total for ${data.month ? monthLabel(data.month).split(' ')[0] : 'the month'}`} /> : null}
            {isPhone && tab === 'expenses' && todo.length && rows.length ? (
              <h2 className="ccr-todo-h" style={{ display: 'flex' }}>{data.month ? monthLabel(data.month).split(' ')[0] : ''}<span style={{ marginLeft: 'auto', textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>{formatMoney(shown.cents)} · {shown.count}</span></h2>
            ) : null}

            {remindRows.length && (ticked.length || (isPhone && selecting)) ? (
              <div className="ccr-selbar" role="region" aria-label="Selected receipts">
                <span className="ccr-selbar-n">{ticked.length} selected</span>
                <button type="button" className="ccr-btn gold" disabled={!ticked.length} onClick={() => setOpen({ kind: 'remind', expenses: ticked })}>Send reminder</button>
                {!allShown ? <button type="button" className="ccr-btn" onClick={toggleAll}>Select all shown</button> : null}
                <button type="button" className="ccr-btn" onClick={clearSelection}>{isPhone ? 'Cancel' : 'Clear'}</button>
              </div>
            ) : remindRows.length && isPhone ? (
              <div className="ccr-selbar is-idle">
                <button type="button" className="ccr-btn" onClick={() => setSelecting(true)}>Select</button>
              </div>
            ) : null}

            <div className={`ccr-box${data.loading ? ' is-loading' : ''}`} aria-busy={data.loading}>
              {rows.length ? (
                <ExpenseList rows={paged} isPhone={isPhone} categories={categories} showHolder={tab === 'waiting' || data.viewAll}
                  shownCents={shown.cents} shownCount={shown.count} onOpen={(e) => setOpenId(e.id)} selection={selection} />
              ) : (
                <div className="ccr-empty">
                  {data.loading ? <span>Loading…</span> : tab === 'waiting' && data.waitingError ? (
                    <span>The receipts waiting for you couldn’t be loaded.</span>
                  ) : base.length ? (
                    <><h3>Nothing matches</h3><span>Clear the search or the filters.</span></>
                  ) : tab === 'waiting' ? (
                    data.waiting.length
                      ? <><h3>Nothing in this group</h3><span>Pick All to see everything waiting for you.</span></>
                      : <><h3>Nothing is waiting for you</h3><span>Receipts you approve, and questions asked of you, show here.</span></>
                  ) : (
                    <>
                      <h3>No receipts for {data.month ? monthLabel(data.month) : 'this month'}</h3>
                      {canAdd ? <button type="button" className="ccr-btn gold" onClick={() => setOpen({ kind: 'choose' })}><Camera size={16} aria-hidden="true" /> Add receipt</button> : null}
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

      {canAdd ? (
        <button type="button" className="ccr-fab" aria-label="Add receipt" title="Add receipt" onClick={() => setOpen({ kind: 'choose' })}>
          <Camera size={24} strokeWidth={2.2} aria-hidden="true" />
        </button>
      ) : null}

      {opened ? (
        <ExpenseDrawer
          expense={opened}
          categories={categories}
          today={me?.today || ''}
          canEdit={(opened.mine && canUse && holderMayEdit(opened)) || (canEditAny && anyoneMayEdit(opened))}
          canVoid={opened.status !== 'missing' && ((opened.mine && canUse && holderMayEdit(opened) && !opened.canDecide) || (canVoidAny && !opened.voided))}
          canDelete={canDelete && opened.status !== 'missing'}
          onDelete={() => setOpen({ kind: 'delete', expense: opened })}
          canRemind={canRemind}
          onEdit={() => setOpen({ kind: 'edit', expense: opened })}
          onVoid={() => setOpen({ kind: 'void', expense: opened })}
          onApprove={async (comment) => {
            const saved = await data.approve(opened, comment);
            say(saved.status === 'approved' ? 'Approved' : 'Approval saved');
            openNext(opened.id);
          }}
          onAnswer={async (text) => { await data.answer(opened, text); say('Answered and approved'); openNext(opened.id); }}
          onSendBack={async (comment) => { await data.sendBack(opened, comment); say('Sent back'); setOpenId(null); }}
          onAsk={() => setOpen({ kind: 'ask', expense: opened })}
          onWithdrawAsk={async () => { await data.withdrawAsk(opened); say('Question withdrawn'); }}
          onReopen={() => setOpen({ kind: 'reopen', expense: opened })}
          onRemind={() => setOpen({ kind: 'remind', expenses: [opened] })}
          onFillDetails={async (body) => { await data.fillDetails(opened, body); say('Details saved'); }}
          nearReceipts={data.nearReceipts}
          onUseReceipt={async (receiptId) => {
            const saved = await data.matchToCharge(opened, receiptId);
            say('Matched to the charge');
            // Open the receipt that now answers the charge (in its own month).
            if (tab === 'expenses' && monthOf(saved.date) !== data.month) data.setMonth(monthOf(saved.date));
            setOpenId(saved.id);
          }}
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
          cards={open.kind === 'edit' && !open.expense.mine ? [] : me?.cards || []}
          holders={canAddForOthers ? addHolders : []}
          meId={me?.user.id || ''}
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

      {open?.kind === 'export' ? (
        <ExportDialog month={data.month || ''} canExport={canExport} canExportAll={canExportAll} startBank={filters.bank}
          onExport={runExport} onClose={() => setOpen(null)} />
      ) : null}

      {open?.kind === 'void' ? (
        <VoidExpenseForm expense={open.expense} onClose={() => setOpen(null)}
          onVoid={async (reason) => { await data.voidOne(open.expense, reason); setOpen(null); setOpenId(null); say('Expense voided'); }} />
      ) : null}

      {open?.kind === 'ask' ? (
        <AskForm expense={open.expense} loadTargets={data.askTargets} onClose={() => setOpen(null)}
          onAsk={async (to, question) => { await data.ask(open.expense, to, question); setOpen(null); say('Question sent'); }} />
      ) : null}

      {open?.kind === 'reopen' ? (
        <ReopenForm expense={open.expense} onClose={() => setOpen(null)}
          onReopen={async (reason) => { await data.reopen(open.expense, reason); setOpen(null); say('Reopened'); }} />
      ) : null}

      {open?.kind === 'remind' ? (
        <RemindDialog expenses={open.expenses} onSend={data.remind}
          onClose={() => { if (open.expenses.length > 1) clearSelection(); setOpen(null); }} />
      ) : null}

      {open?.kind === 'delete' ? (
        <DeleteExpenseForm expense={open.expense} onClose={() => setOpen(null)}
          onDelete={async (reason) => { await data.deleteOne(open.expense, reason); setOpen(null); setOpenId(null); say('Receipt deleted'); }} />
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
