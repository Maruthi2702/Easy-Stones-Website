import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Upload } from 'lucide-react';
import DashboardSearch from '../../../components/shared/DashboardSearch';
import Pagination from '../../../components/shared/Pagination';
import { usePagination } from '../../../components/shared/paginationConfig';
import { formatMoney, monthLabel, usDate } from '../../../utils/cardReceipts';
import { LINE_STATUSES, lineStatusLabel, type Issuer, type LineStatus } from '../../../utils/amexStatement';
import type { LineStage } from '../../../utils/statementStage';
import * as api from './statementsApi';
import {
  BANK_KEYS, BANK_NAMES, branchClass, categoryParts, holderOfLine, linesOfBank, periodLabel, statusWord, unsetCardsNote, visibleLines
} from './statementsView';
import AmexUploadForm from './AmexUploadForm';
import UnknownCards from './UnknownCards';
import FilterMenu from '../components/FilterMenu';
import type { StatementLine, StatementsView, UploadResult } from './statementsApi';
import './Statements.css';

/** The Status filter's dot by status (the same colours as the row and the Status column). */
const DOT: Record<LineStatus, string> = { missing: 'miss', matched: 'ok', awaiting: 'wait', no_card: 'back', unassigned: 'back', before_start: 'none', no_receipt: 'none', refunded: 'none', dismissed: 'none' };

const BANK_KEY = 'ccr-statements-bank';
const savedBank = (): Issuer => {
  try { const v = window.localStorage.getItem(BANK_KEY); return v === 'encore' ? 'encore' : 'amex'; } catch { return 'amex'; }
};

/** A line's Status column: the server's stage, or (an older server) the status's own words. */
const stageOf = (l: StatementLine): LineStage => l.stage ?? { tone: DOT[l.status] as LineStage['tone'], label: statusWord(l.status, lineStatusLabel(l.status)), detail: '' };

/**
 * Credit Card Receipts → Statements (the card check). Design: claude.ai artifact "Statement row colours"
 * (https://claude.ai/artifact/GSbdExUZTArcH7EgsDWQjP, board C; owner 2026-11-24): the Customers tab's look —
 * its search and gold button in the page header, Bank / Status / Cardholder dropdowns on the tab row
 * (`headSlot` / `tabSlot`, portaled into the page's own header so nothing floats outside it), and its table
 * spacing. Rows carry no colour (every row is a statement line); the Status column says where the
 * receipt is in its approvals (statementStage.ts). Amex and Encore stay apart (one bank at a time, no "All").
 */
export default function StatementsPanel({ month, isPhone, canCards, onOpenCards, onSaved, headSlot = null, tabSlot = null, onCount }: {
  month: string; isPhone: boolean; canCards: boolean; onOpenCards: () => void; onSaved: (text: string) => void;
  /** The page header's tools box: the search and Upload statement go there (desktop). */
  headSlot?: HTMLElement | null;
  /** The tab row's right side: the Bank, Status and Cardholder dropdowns go there (desktop). */
  tabSlot?: HTMLElement | null;
  /** How many lines the bank on screen has, for the count beside the page title. */
  onCount?: (n: number | null) => void;
}) {
  const [view, setView] = useState<StatementsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [bank, setBank] = useState<Issuer>(savedBank);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<LineStatus | 'all'>('all');
  const [holder, setHolder] = useState('');
  const [uploading, setUploading] = useState(false);
  const pager = usePagination();

  const load = useCallback(async () => {
    setLoading(true);
    try { setView(await api.loadStatements(month)); setError(''); } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, [month]);
  useEffect(() => { load(); }, [load]);
  const { resetPage } = pager;
  useEffect(() => { resetPage(); }, [month, bank, search, status, holder, resetPage]);

  const pickBank = (b: string) => {
    const next: Issuer = b === 'encore' ? 'encore' : 'amex';
    setBank(next); setStatus('all'); setHolder('');
    try { window.localStorage.setItem(BANK_KEY, next); } catch { /* remembering is a convenience */ }
  };

  const bankLines = useMemo(() => linesOfBank(view?.lines || [], bank), [view?.lines, bank]);
  const { base, rows, counts, holders } = useMemo(() => visibleLines(bankLines, { search, status, holder }), [bankLines, search, status, holder]);
  useEffect(() => { onCount?.(view ? bankLines.length : null); }, [onCount, view, bankLines.length]);
  useEffect(() => () => onCount?.(null), [onCount]);
  const paged = rows.slice((pager.currentPage - 1) * pager.rowsPerPage, pager.currentPage * pager.rowsPerPage);
  const last = view?.imports.find((i) => i.issuer === bank);
  const bankImports = useMemo(() => linesOfBank(view?.imports || [], bank), [view?.imports, bank]);
  const unsetOf = (b: Issuer) => (view?.unknownCards || []).filter((c) => c.issuer === b);
  const unset = unsetOf(bank);
  const missing = view?.missingByBank?.[bank];
  const name = BANK_NAMES[bank];

  const uploaded = (r: UploadResult) => {
    setUploading(false);
    const made = r.check.created;
    onSaved(`Checked ${r.lines.toLocaleString()} lines${made ? ` · ${made} Missing receipt ${made === 1 ? 'row' : 'rows'} made` : ''}`);
    load();
  };

  const statusChoices = [{ value: 'all', label: 'All', count: base.length },
    ...LINE_STATUSES.filter((s) => counts[s.key].count || s.key === 'matched' || s.key === 'missing')
      .map((s) => ({ value: s.key, label: statusWord(s.key, s.label), count: counts[s.key].count, dot: DOT[s.key] }))];
  const holderChoices = [{ value: '', label: 'Everyone' }, ...holders.map((h) => ({ value: h.name, label: h.name, count: h.count }))];
  const bankChoices = BANK_KEYS.map((b) => ({ value: b, label: BANK_NAMES[b], count: linesOfBank(view?.lines || [], b).length }));

  const filters = (
    <>
      <FilterMenu label="Bank" value={bank} choices={bankChoices} onChange={pickBank} />
      <FilterMenu label="Status" value={status} clearTo="all" choices={statusChoices} onChange={(v) => setStatus(v as LineStatus | 'all')} />
      <FilterMenu label="Cardholder" value={holder} clearTo="" choices={holderChoices} onChange={setHolder} searchable={holders.length > 8} align="right" />
    </>
  );
  const searchBox = (
    <DashboardSearch value={search} onChange={setSearch} label={`Search ${name} lines`} placeholder="Search merchant, cardholder, card"
      count={search ? `${base.length} of ${bankLines.length}` : null} />
  );
  const uploadButton = (
    <button type="button" className="ccr-btn gold" onClick={() => setUploading(true)} aria-label={isPhone ? `Upload ${name} statement` : undefined}>
      <Upload size={16} aria-hidden="true" />{isPhone ? null : ' Upload statement'}
    </button>
  );

  const notice = unset.length ? (
    canCards ? (
      <div className="ccr-st-warn" role="status">
        <span><b>{unsetCardsNote(unset.length, bank)}.</b> Their charges show as Card not set up until a holder is chosen.</span>
        <button type="button" className="ccr-btn" onClick={onOpenCards}>Set up in Cards</button>
      </div>
    ) : (
      <UnknownCards cards={unset} people={view?.people || []} onSetUp={async (digits, userId, replace, issuer) => {
        const r = await api.setUpCard(digits, userId, replace, issuer);
        onSaved(r.check.created ? `Card set up · ${r.check.created} Missing receipt ${r.check.created === 1 ? 'row' : 'rows'} made` : 'Card set up');
        load();
      }} />
    )
  ) : null;

  const lastLine = (
    <div className="ccr-st-meta">
      <span>{last ? `Last ${name} upload ${usDate(String(last.at).slice(0, 10))}${last.byName ? ` by ${last.byName}` : ''}` : `No ${name} statement uploaded yet`}</span>
      {last ? <span>{periodLabel(last.periodFrom, last.periodTo)} · {last.lines.toLocaleString()} lines, {last.added.toLocaleString()} new</span> : null}
      {missing ? (missing.count
        ? <span className="is-miss">{missing.count.toLocaleString()} receipts still missing · {formatMoney(missing.cents)}</span>
        : <span>No receipts missing</span>) : null}
    </div>
  );

  // On a computer the search and Upload go into the page header and the dropdowns onto the tab row, as on the Customers tab.
  const portaled = !isPhone && headSlot && tabSlot;

  return (
    <div className="ccr-st">
      {portaled ? <>{createPortal(<>{searchBox}{uploadButton}</>, headSlot)}{createPortal(filters, tabSlot)}</> : (
        <>
          {searchBox}
          <div className="ccr-st-bar">{filters}<span className="ccr-st-bar-end">{uploadButton}</span></div>
        </>
      )}

      {lastLine}
      {error ? <div className="ccr-note is-error" role="alert">{error}</div> : null}
      {notice}

      <div className={`ccr-box${loading ? ' is-loading' : ''}`} aria-busy={loading}>
        {rows.length ? <Lines rows={paged} isPhone={isPhone} /> : (
          <div className="ccr-empty">
            {loading ? <span>Loading…</span> : base.length || holder ? <><h3>Nothing matches</h3><span>Clear the search or the filters.</span></>
              : <><h3>No {name} lines for {monthLabel(month)}</h3><span>Upload {bank === 'encore' ? 'Encore’s transactions export' : 'Amex’s activity export'} to check it against the receipts.</span></>}
          </div>
        )}
      </div>
      <Pagination currentPage={pager.currentPage} totalPages={Math.max(1, Math.ceil(rows.length / pager.rowsPerPage))}
        onPageChange={pager.setCurrentPage} rowsPerPage={pager.rowsPerPage} onRowsPerPageChange={pager.setRowsPerPage} totalCount={rows.length} />

      {bankImports.length ? (
        <div className="ccr-box">
          <h2 className="ccr-st-h">{name} uploads</h2>
          <div className="ccr-table-wrap">
            <table className="ccr-table ccr-st-uploads">
              <thead><tr><th>Uploaded</th><th>Period</th><th className="ccr-col-wide">File</th><th className="ccr-num">Lines</th><th className="ccr-num">New</th><th className="ccr-num">Charges</th><th>By</th></tr></thead>
              <tbody>
                {bankImports.map((i) => (
                  <tr key={i.id}>
                    <td>{usDate(String(i.at).slice(0, 10))}</td>
                    <td>{periodLabel(i.periodFrom, i.periodTo)}</td>
                    <td className="ccr-col-wide ccr-st-file">{i.fileName}</td>
                    <td className="ccr-num">{i.lines.toLocaleString()}</td>
                    <td className="ccr-num">{i.added.toLocaleString()}</td>
                    <td className="ccr-num">{formatMoney(i.chargesCents)}</td>
                    <td>{i.byName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {uploading ? <AmexUploadForm initialIssuer={bank} onDone={uploaded} onClose={() => setUploading(false)} /> : null}
    </div>
  );
}

/** The Status column: the Customers tab's dot and word, the stage's detail under it. */
function Stage({ stage }: { stage: LineStage }) {
  return (
    <span className="ccr-stage">
      <span className={`ccr-stage-l is-${stage.tone}`}><span className={`ccr-sdot is-${stage.tone}`} aria-hidden="true" />{stage.label}</span>
      {stage.detail ? <span className="ccr-stage-d">{stage.detail}</span> : null}
    </span>
  );
}

/** Date · Cardholder & card · Merchant · Category · Amount · Status (owner's order, 2026-11-24). */
function Lines({ rows, isPhone }: { rows: StatementLine[]; isPhone: boolean }) {
  const card = (l: StatementLine) => l.cardLabel || (l.digits ? `…${l.digits}` : 'no card');
  const amountClass = (l: StatementLine) => `ccr-amt${l.cents < 0 ? ' ccr-st-credit' : ''}`;
  if (isPhone) {
    return (
      <div className="ccr-st-plist">
        {rows.map((l) => {
          return (
            <div key={l.reference} className="ccr-st-pcard">
              <div className="ccr-st-ptop"><b>{holderOfLine(l) || 'No cardholder'}</b><b className={amountClass(l)}>{formatMoney(l.cents)}</b></div>
              <div className="ccr-st-sub">{l.description}</div>
              <div className="ccr-st-sub">{usDate(l.date)} · {card(l)}</div>
              <Stage stage={stageOf(l)} />
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <div className="ccr-table-wrap">
      <table className="ccr-table ccr-st-lines">
        <thead>
          <tr><th>Date</th><th>Cardholder &amp; card</th><th>Merchant</th><th className="ccr-col-wide">Category</th><th className="ccr-num">Amount</th><th>Status</th></tr>
        </thead>
        <tbody>
          {rows.map((l) => {
            const who = holderOfLine(l);
            const cat = categoryParts(l.amexCategory);
            return (
              <tr key={l.reference}>
                <td className="ccr-st-date">{usDate(l.date)}</td>
                <td>
                  <div className="ccr-st-who"><span className="ccr-av" aria-hidden="true">{(who[0] || '?').toUpperCase()}</span><span className="ccr-st-name">{who || 'No cardholder'}</span></div>
                  <div className="ccr-st-card">{l.branch ? <span className={`ccr-branch ${branchClass(l.branch)}`}>{l.branch}</span> : null}<span>{card(l)}</span></div>
                </td>
                <td><div className="ccr-st-m">{l.description}</div>{l.cityState ? <div className="ccr-st-sub">{l.cityState}</div> : null}</td>
                <td className="ccr-col-wide"><div>{cat.main}</div>{cat.sub ? <div className="ccr-st-sub">{cat.sub}</div> : null}</td>
                <td className={`ccr-num ${amountClass(l)}`}>{formatMoney(l.cents)}</td>
                <td><Stage stage={stageOf(l)} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
