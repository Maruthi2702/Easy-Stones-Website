import { useCallback, useEffect, useMemo, useState } from 'react';
import { CreditCard, Upload } from 'lucide-react';
import DashboardSearch from '../../../components/shared/DashboardSearch';
import { FormSearchPicker } from '../../../components/shared/form/FormControls';
import Pagination from '../../../components/shared/Pagination';
import { usePagination } from '../../../components/shared/paginationConfig';
import { formatMoney, monthLabel, usDate } from '../../../utils/cardReceipts';
import { LINE_STATUSES, lineStatusLabel, type LineStatus } from '../../../utils/amexStatement';
import * as api from './statementsApi';
import { periodLabel, personOptions, visibleLines } from './statementsView';
import AmexUploadForm from './AmexUploadForm';
import type { StatementLine, StatementsView, UnknownCard, UploadResult } from './statementsApi';
import './Statements.css';

const CHIP: Record<LineStatus, string> = { missing: 'miss', matched: 'ok', no_card: 'back', unassigned: 'back', before_start: 'draft', no_receipt: 'draft' };
const DOT: Record<LineStatus, string> = CHIP;

const StatusChip = ({ status }: { status: LineStatus }) => <span className={`ccr-chip is-${CHIP[status]}`}>{lineStatusLabel(status)}</span>;

/**
 * Credit Card Receipts → Statements (the Amex check). Design: the Statements board of the
 * claude.ai canvas "Credit Card Receipts UX", with the owner's calls of 2026-11-20 (exact
 * matching, so no "To check"; unknown cards set up here). One month of Amex lines by Amex's day,
 * the page's month stepper choosing it.
 */
export default function StatementsPanel({ month, isPhone, onSaved }: { month: string; isPhone: boolean; onSaved: (text: string) => void }) {
  const [view, setView] = useState<StatementsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<LineStatus | 'all'>('all');
  const [uploading, setUploading] = useState(false);
  const pager = usePagination();

  const load = useCallback(async () => {
    setLoading(true);
    try { setView(await api.loadStatements(month)); setError(''); } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, [month]);
  useEffect(() => { load(); }, [load]);
  const { resetPage } = pager;
  useEffect(() => { resetPage(); }, [month, search, status, resetPage]);

  const { base, rows, counts } = useMemo(() => visibleLines(view?.lines || [], { search, status }), [view?.lines, search, status]);
  const paged = rows.slice((pager.currentPage - 1) * pager.rowsPerPage, pager.currentPage * pager.rowsPerPage);
  const last = view?.imports[0];

  const uploaded = (r: UploadResult) => {
    setUploading(false);
    const made = r.check.created;
    onSaved(`Checked ${r.lines.toLocaleString()} lines${made ? ` · ${made} Missing receipt ${made === 1 ? 'row' : 'rows'} made` : ''}`);
    load();
  };

  return (
    <div className="ccr-st">
      <div className="ccr-st-top">
        <div className="ccr-st-last">
          <b>{last ? `Last upload ${usDate(String(last.at).slice(0, 10))}${last.byName ? ` by ${last.byName}` : ''}` : 'Nothing uploaded yet'}</b>
          <span>
            {last ? `${periodLabel(last.periodFrom, last.periodTo)} · ${last.lines.toLocaleString()} lines, ${last.added.toLocaleString()} new · ` : ''}
            {view ? (view.missingNow.count
              ? `${view.missingNow.count.toLocaleString()} receipts still missing · ${formatMoney(view.missingNow.cents)}`
              : 'No receipts missing') : ''}
          </span>
        </div>
        <button type="button" className="ccr-btn gold" onClick={() => setUploading(true)}><Upload size={16} aria-hidden="true" /> Upload Amex activity</button>
      </div>

      {error ? <div className="ccr-note is-error" role="alert">{error}</div> : null}

      {view?.unknownCards.length ? (
        <UnknownCards cards={view.unknownCards} people={view.people} onSetUp={async (digits, userId, replace) => {
          const r = await api.setUpCard(digits, userId, replace);
          onSaved(r.check.created ? `Card set up · ${r.check.created} Missing receipt ${r.check.created === 1 ? 'row' : 'rows'} made` : 'Card set up');
          load();
        }} />
      ) : null}

      <div className="ccr-st-bar">
        <h2>{monthLabel(month)} on Amex</h2>
        <DashboardSearch value={search} onChange={setSearch} label="Search Amex lines" placeholder="Search merchant, cardholder, card"
          count={search ? `${base.length} of ${view?.lines.length || 0}` : null} />
      </div>

      {!isPhone ? (
        <div className="ccr-tiles">
          {LINE_STATUSES.map((s) => {
            const t = counts[s.key];
            const on = status === s.key;
            if (!t.count && (s.key === 'no_card' || s.key === 'unassigned' || s.key === 'before_start')) return null;
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
      ) : (
        <div className="ccr-st-chips" role="group" aria-label="Status">
          {(['all', ...LINE_STATUSES.map((s) => s.key)] as const).map((k) => (
            <button key={k} type="button" className={`ccr-st-chipbtn${status === k ? ' is-on' : ''}`} aria-pressed={status === k} onClick={() => setStatus(k)}>
              {k === 'all' ? `All · ${base.length}` : `${lineStatusLabel(k)} · ${counts[k].count}`}
            </button>
          ))}
        </div>
      )}

      <div className={`ccr-box${loading ? ' is-loading' : ''}`} aria-busy={loading}>
        {rows.length ? <Lines rows={paged} isPhone={isPhone} /> : (
          <div className="ccr-empty">
            {loading ? <span>Loading…</span> : base.length ? <><h3>Nothing matches</h3><span>Clear the search or the status.</span></>
              : <><h3>No Amex lines for {monthLabel(month)}</h3><span>Upload Amex’s activity export to check it against the receipts.</span></>}
          </div>
        )}
      </div>
      <Pagination currentPage={pager.currentPage} totalPages={Math.max(1, Math.ceil(rows.length / pager.rowsPerPage))}
        onPageChange={pager.setCurrentPage} rowsPerPage={pager.rowsPerPage} onRowsPerPageChange={pager.setRowsPerPage} totalCount={rows.length} />

      {view?.imports.length ? (
        <div className="ccr-box">
          <h2 className="ccr-st-h">Uploads</h2>
          <div className="ccr-table-wrap">
            <table className="ccr-table ccr-st-uploads">
              <thead><tr><th>Uploaded</th><th>Period</th><th className="ccr-col-wide">File</th><th className="ccr-num">Lines</th><th className="ccr-num">New</th><th className="ccr-num">Charges</th><th>By</th></tr></thead>
              <tbody>
                {view.imports.map((i) => (
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

      {uploading ? <AmexUploadForm onDone={uploaded} onClose={() => setUploading(false)} /> : null}
    </div>
  );
}

/** Each line: Amex's day, card, who holds it, what Amex printed, the amount and where it stands. */
function Lines({ rows, isPhone }: { rows: StatementLine[]; isPhone: boolean }) {
  const who = (l: StatementLine) => l.holderName || l.cardMember;
  const card = (l: StatementLine) => l.cardLabel || `…${l.digits}`;
  if (isPhone) {
    return (
      <div className="ccr-cards">
        {rows.map((l) => (
          <div key={l.reference} className="ccr-card ccr-st-card">
            <b className="ccr-st-desc">{l.description}</b>
            <span className={`ccr-amt${l.cents < 0 ? ' ccr-st-credit' : ''}`}>{formatMoney(l.cents)}</span>
            <span className="ccr-card-meta">{usDate(l.date)} · {who(l)} · {card(l)}</span>
            <span style={{ justifySelf: 'end' }}><StatusChip status={l.status} /></span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="ccr-table-wrap">
      <table className="ccr-table ccr-st-lines">
        <thead>
          <tr><th>Date</th><th>Cardholder</th><th>As Amex prints it</th><th className="ccr-col-wide">Amex category</th><th className="ccr-num">Amount</th><th>Status</th></tr>
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

/** Cards Amex named that nobody has set up: pick the holder, Set up card, and their charges are checked. */
function UnknownCards({ cards, people, onSetUp }: {
  cards: UnknownCard[]; people: StatementsView['people']; onSetUp: (digits: string, userId: string, replace: boolean) => Promise<void>;
}) {
  const [picks, setPicks] = useState<Record<string, string>>(() => Object.fromEntries(cards.map((c) => [c.digits, c.suggestedUserId])));
  const [busy, setBusy] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const options = useMemo(() => personOptions(people), [people]);
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name || '';
  return (
    <div className="ccr-box ccr-st-unset">
      <h2 className="ccr-st-h"><CreditCard size={16} aria-hidden="true" /> Cards not set up · {cards.length}</h2>
      <div className="ccr-st-unknown">
        {cards.map((c) => (
          <div key={c.digits} className="ccr-st-urow">
            <div className="ccr-who">
              <b>{c.cardMember}</b>
              <span>…{c.digits} · {c.charges} {c.charges === 1 ? 'charge' : 'charges'}, {formatMoney(c.cents)} · {usDate(c.first)} to {usDate(c.last)}</span>
              {notes[c.digits] ? <span className="ccr-st-note" role="alert">{notes[c.digits]}</span> : null}
            </div>
            <div className="ccr-st-pick fm-tokens">
              <FormSearchPicker id={`ccr-st-u-${c.digits}`} value={picks[c.digits] || ''} selectedLabel={picks[c.digits] ? nameOf(picks[c.digits]!) : 'Choose the cardholder'}
                onChange={(id) => setPicks((p) => ({ ...p, [c.digits]: id }))} options={options.slice(1)}
                placeholder="Choose the cardholder" searchPlaceholder="Search people" sheetTitle={`Card …${c.digits}`} keepInForm />
            </div>
            <button type="button" className="ccr-btn" disabled={!picks[c.digits] || Boolean(busy)} onClick={async () => {
              setBusy(c.digits);
              setNotes(({ [c.digits]: _gone, ...rest }) => rest);
              const had = people.find((p) => p.id === picks[c.digits])?.card;
              if (had && !window.confirm(`${nameOf(picks[c.digits]!)} already has card ${had}. Deactivate it and set up …${c.digits} instead?`)) { setBusy(''); return; }
              try { await onSetUp(c.digits, picks[c.digits]!, Boolean(had)); } catch (e) { setNotes((n) => ({ ...n, [c.digits]: (e as Error).message })); } finally { setBusy(''); }
            }}>{busy === c.digits ? 'Setting up…' : 'Set up card'}</button>
          </div>
        ))}
      </div>
    </div>
  );
}
