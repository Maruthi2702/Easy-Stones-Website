import { useCallback, useEffect, useMemo, useState } from 'react';
import { Filter, Upload } from 'lucide-react';
import DashboardSearch from '../../../components/shared/DashboardSearch';
import Pagination from '../../../components/shared/Pagination';
import { usePagination } from '../../../components/shared/paginationConfig';
import { formatMoney, monthLabel, usDate } from '../../../utils/cardReceipts';
import { LINE_STATUSES, lineStatusLabel, type Issuer, type LineStatus } from '../../../utils/amexStatement';
import * as api from './statementsApi';
import { BANK_KEYS, BANK_NAMES, linesOfBank, periodLabel, unsetCardsNote, visibleLines } from './statementsView';
import AmexUploadForm from './AmexUploadForm';
import UnknownCards from './UnknownCards';
import type { StatementLine, StatementsView, UploadResult } from './statementsApi';
import './Statements.css';

const CHIP: Record<LineStatus, string> = { missing: 'miss', matched: 'ok', awaiting: 'wait', no_card: 'back', unassigned: 'back', before_start: 'draft', no_receipt: 'draft' };
const DOT: Record<LineStatus, string> = CHIP;

const StatusChip = ({ status }: { status: LineStatus }) => <span className={`ccr-chip is-${CHIP[status]}`}>{lineStatusLabel(status)}</span>;

const BANK_KEY = 'ccr-statements-bank';
const savedBank = (): Issuer => {
  try { const v = window.localStorage.getItem(BANK_KEY); return v === 'encore' ? 'encore' : 'amex'; } catch { return 'amex'; }
};

/**
 * Credit Card Receipts → Statements (the card check). Design: the claude.ai artifact "Statements by bank"
 * (2026-11-23, owner's ask: keep Amex and Encore apart). An Amex | Encore switch; everything under it —
 * tiles, lines, uploads, last upload, the still-missing count — is that bank's alone. The cards not set up
 * are set up on the Cards tab; this tab only says how many a bank has (with no Cards tab to go to, the box
 * stays here so nobody is stranded). One month of lines by the bank's day, the page's month stepper choosing it.
 */
export default function StatementsPanel({ month, isPhone, canCards, onOpenCards, onSaved }: {
  month: string; isPhone: boolean; canCards: boolean; onOpenCards: () => void; onSaved: (text: string) => void;
}) {
  const [view, setView] = useState<StatementsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [bank, setBank] = useState<Issuer>(savedBank);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<LineStatus | 'all'>('all');
  const [uploading, setUploading] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const pager = usePagination();

  const load = useCallback(async () => {
    setLoading(true);
    try { setView(await api.loadStatements(month)); setError(''); } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, [month]);
  useEffect(() => { load(); }, [load]);
  const { resetPage } = pager;
  useEffect(() => { resetPage(); }, [month, bank, search, status, resetPage]);

  const pickBank = (b: Issuer) => {
    setBank(b); setStatus('all'); setFilterOpen(false);
    try { window.localStorage.setItem(BANK_KEY, b); } catch { /* remembering is a convenience */ }
  };

  const bankLines = useMemo(() => linesOfBank(view?.lines || [], bank), [view?.lines, bank]);
  const { base, rows, counts } = useMemo(() => visibleLines(bankLines, { search, status }), [bankLines, search, status]);
  const paged = rows.slice((pager.currentPage - 1) * pager.rowsPerPage, pager.currentPage * pager.rowsPerPage);
  const last = view?.imports.find((i) => i.issuer === bank);
  const bankImports = useMemo(() => linesOfBank(view?.imports || [], bank), [view?.imports, bank]);
  const unsetOf = (b: Issuer) => (view?.unknownCards || []).filter((c) => c.issuer === b);
  const unset = unsetOf(bank);
  const missing = view?.missingByBank?.[bank];
  const name = BANK_NAMES[bank];
  const tiles = LINE_STATUSES.filter((s) => counts[s.key].count || !(s.key === 'no_card' || s.key === 'unassigned' || s.key === 'before_start'));

  const uploaded = (r: UploadResult) => {
    setUploading(false);
    const made = r.check.created;
    onSaved(`Checked ${r.lines.toLocaleString()} lines${made ? ` · ${made} Missing receipt ${made === 1 ? 'row' : 'rows'} made` : ''}`);
    load();
  };

  const switcher = (
    <div className="ccr-bank-seg" role="tablist" aria-label="Bank">
      {BANK_KEYS.map((b) => (
        <button key={b} type="button" role="tab" aria-selected={bank === b} className={bank === b ? 'is-on' : ''} onClick={() => pickBank(b)}>
          <span className={`ccr-bank-sw is-${b}`} aria-hidden="true" />{BANK_NAMES[b]}
          <span className="ccr-bank-n">{linesOfBank(view?.lines || [], b).length}</span>
          {unsetOf(b).length ? <span className="ccr-bank-flag" title={unsetCardsNote(unsetOf(b).length, b)} role="img" aria-label={unsetCardsNote(unsetOf(b).length, b)} /> : null}
        </button>
      ))}
    </div>
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

  const statusOptions = [{ key: 'all' as const, label: 'All', count: base.length, cents: null as number | null, dot: '' },
    ...tiles.map((s) => ({ key: s.key, label: s.label, count: counts[s.key].count, cents: counts[s.key].cents as number | null, dot: DOT[s.key] }))];

  return (
    <div className="ccr-st">
      {isPhone ? (
        <div className="ccr-st-ptop">
          <b>{monthLabel(month)}</b>
          <span className="ccr-st-pact">
            <button type="button" className={`ccr-st-fbtn${status !== 'all' ? ' has' : ''}`} aria-label="Filter by status" aria-expanded={filterOpen} onClick={() => setFilterOpen((o) => !o)}>
              <Filter size={18} aria-hidden="true" />{status !== 'all' ? <i className="ccr-st-fdot" aria-hidden="true" /> : null}
            </button>
            <button type="button" className="ccr-btn gold" onClick={() => setUploading(true)} aria-label={`Upload ${name} statement`}><Upload size={16} aria-hidden="true" /> Upload</button>
          </span>
        </div>
      ) : (
        <div className="ccr-st-top">
          <div className="ccr-st-last">
            <b>{last ? `Last ${name} upload ${usDate(String(last.at).slice(0, 10))}${last.byName ? ` by ${last.byName}` : ''}` : `No ${name} statement uploaded yet`}</b>
            <span>
              {last ? `${periodLabel(last.periodFrom, last.periodTo)} · ${last.lines.toLocaleString()} lines, ${last.added.toLocaleString()} new · ` : ''}
              {missing ? (missing.count
                ? `${missing.count.toLocaleString()} receipts still missing · ${formatMoney(missing.cents)}`
                : 'No receipts missing') : ''}
            </span>
          </div>
          <button type="button" className="ccr-btn gold" onClick={() => setUploading(true)}><Upload size={16} aria-hidden="true" /> Upload statement</button>
        </div>
      )}

      {switcher}

      {error ? <div className="ccr-note is-error" role="alert">{error}</div> : null}
      {notice}

      {isPhone ? (
        <>
          <DashboardSearch value={search} onChange={setSearch} label={`Search ${name} lines`} placeholder="Search merchant, cardholder, card"
            count={search ? `${base.length} of ${bankLines.length}` : null} />
          {filterOpen ? (
            <div className="ccr-st-sheet" role="group" aria-label="Status">
              {statusOptions.map((o) => (
                <button key={o.key} type="button" className={`ccr-st-opt${status === o.key ? ' is-on' : ''}`} aria-pressed={status === o.key}
                  onClick={() => { setStatus(o.key); setFilterOpen(false); }}>
                  <span>{o.dot ? <span className={`ccr-dot is-${o.dot}`} aria-hidden="true" /> : null} {o.label}</span>
                  <span>{o.count.toLocaleString()}{o.cents === null ? '' : ` · ${formatMoney(o.cents)}`}</span>
                </button>
              ))}
            </div>
          ) : null}
          {status !== 'all' ? (
            <div className="ccr-st-cur"><span>Status: <b>{lineStatusLabel(status)}</b></span><button type="button" onClick={() => setStatus('all')}>Clear</button></div>
          ) : null}
        </>
      ) : (
        <>
          <div className="ccr-st-bar">
            <h2>{monthLabel(month)} · {name}</h2>
            <DashboardSearch value={search} onChange={setSearch} label={`Search ${name} lines`} placeholder="Search merchant, cardholder, card"
              count={search ? `${base.length} of ${bankLines.length}` : null} />
          </div>
          <div className="ccr-tiles">
            {tiles.map((s) => {
              const t = counts[s.key];
              const on = status === s.key;
              return (
                <button key={s.key} type="button" className={`ccr-tile${on ? ' is-on' : ''}`} aria-pressed={on}
                  title={on ? 'Show every line' : `Show only ${s.label}`} onClick={() => setStatus(on ? 'all' : s.key)}>
                  <span className="ccr-tile-k"><span className={`ccr-dot is-${DOT[s.key]}`} aria-hidden="true" />{s.label}</span>
                  <span className="ccr-tile-v">{t.count.toLocaleString()}</span>
                  <span className="ccr-tile-c">{formatMoney(t.cents)}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      <div className={`ccr-box${loading ? ' is-loading' : ''}`} aria-busy={loading}>
        {rows.length ? <Lines rows={paged} isPhone={isPhone} /> : (
          <div className="ccr-empty">
            {loading ? <span>Loading…</span> : base.length ? <><h3>Nothing matches</h3><span>Clear the search or the status.</span></>
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

/** Each line: the bank's day, who holds the card, what the bank printed, the amount and where it stands. The tab says which bank. */
function Lines({ rows, isPhone }: { rows: StatementLine[]; isPhone: boolean }) {
  const who = (l: StatementLine) => l.holderName || l.cardMember;
  const card = (l: StatementLine) => l.cardLabel || (l.digits ? `…${l.digits}` : 'no card');
  if (isPhone) {
    return (
      <div className="ccr-cards">
        {rows.map((l) => (
          <div key={l.reference} className="ccr-card ccr-st-pcard">
            <span className={`ccr-dot is-${DOT[l.status]}`} aria-hidden="true" />
            <span className="ccr-st-pm">
              <b>{who(l)}</b>
              <span className="ccr-st-desc">{l.description}</span>
              <span className="ccr-card-meta">{usDate(l.date)} · {card(l)}</span>
            </span>
            <span className="ccr-st-pa">
              <b className={`ccr-amt${l.cents < 0 ? ' ccr-st-credit' : ''}`}>{formatMoney(l.cents)}</b>
              <StatusChip status={l.status} />
            </span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="ccr-table-wrap">
      <table className="ccr-table ccr-st-lines">
        <thead>
          <tr><th>Date</th><th>Cardholder</th><th>As the bank prints it</th><th className="ccr-col-wide">Category</th><th className="ccr-num">Amount</th><th>Status</th></tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.reference}>
              <td style={{ whiteSpace: 'nowrap' }}>{usDate(l.date)}</td>
              <td><div className="ccr-who"><b>{who(l)}</b><span>{card(l)}</span></div></td>
              <td className="ccr-st-desc">{l.description}</td>
              <td className="ccr-col-wide ccr-muted">{l.amexCategory.replace(/-/, ' · ')}</td>
              <td className={`ccr-num ccr-amt${l.cents < 0 ? ' ccr-st-credit' : ''}`}>{formatMoney(l.cents)}</td>
              <td><StatusChip status={l.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
