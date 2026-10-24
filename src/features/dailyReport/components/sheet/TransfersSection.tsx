import React from 'react';
import type { RefObject } from 'react';
import { ArrowLeftRight, ArrowDownToLine, ArrowUpFromLine, Plus, X, AlertTriangle } from 'lucide-react';
import ReportSection from '../ReportSection';
import { ReportCell } from '../ReportCell';
import ShippedEarlierNote from '../ShippedEarlierNote';
import { branchCode } from '../../../../config/branches.js';
import { manualTransferDirection, manualTransferWarning, transferWarningText, transferLineKey, cleanTransferNumber } from '../../../../utils/transferDirection.js';
import { ALL, n, splitFromTo, composeFromTo, outOfBand } from '../../reportFigures';
import type { SheetEditors } from '../../sheetEditing';
import type { DayTotals, Report, ShippedEarlierGroup, SlabRange } from '../../types';

export type TransfersSectionProps = {
  report: Report;
  totals: DayTotals;
  locked: boolean;
  date: string;
  /** The open branch (never ALL here). */
  location: string;
  /** Every branch, this one first — the From / To choices. */
  routeLocations: string[];
  compactRoutes: boolean;
  transferTableRef: RefObject<HTMLTableElement | null>;
  shippedEarlier: ShippedEarlierGroup[];
  slabRange: SlabRange | null;
  setDate: (date: string) => void;
  patch: SheetEditors['patch'];
  addTransfer: SheetEditors['addTransfer'];
  rowKeys: SheetEditors['rowKeys'];
  /** A slab figure typed by hand (kept in every save from now on). */
  touchTransferSlabs: (key: string) => void;
};

/** Transfers: lines from the tickets (read-only route and number) and lines added by hand. */
export default function TransfersSection({
  report, totals, locked, date, location, routeLocations, compactRoutes, transferTableRef, shippedEarlier, slabRange,
  setDate, patch, addTransfer, rowKeys, touchTransferSlabs
}: TransfersSectionProps) {
  return (
    <ReportSection
      title="Transfers"
      icon={ArrowLeftRight}
      source={{ kind: 'auto', label: 'from transfer tickets' }}
      footnote={shippedEarlier.length > 0 && (
        <ShippedEarlierNote groups={shippedEarlier} date={date} onOpenDay={setDate} />
      )}
      footnoteTone="info"
      action={!locked && (
        <button className="dr-addrow-btn" onClick={addTransfer}><Plus size={12} /> Add</button>
      )}
    >
      <table ref={transferTableRef} className={`dr-table dr-table--transfers${compactRoutes ? ' is-compact' : ''}`}>
        <thead>
          <tr><th className="dr-transfer-no-th">Transfer #</th><th className="dr-route-th">From — To</th><th className="dr-num">Slabs</th><th className="dr-x" /></tr>
        </thead>
        <tbody>
          {report.transfers.length === 0 && (
            <tr><td colSpan={4} className="dr-none">No transfers today.</td></tr>
          )}
          {report.transfers.map((t, i) => {
            const [fromCode, toCode] = splitFromTo(t.fromTo);
            // A line added by hand takes its direction from its route
            // (manualTransferDirection): ending at this branch is
            // Incoming, anything else Outgoing. Ticket lines keep theirs.
            const setRoute = (from: string, to: string) => patch(r => {
              const line = r.transfers[i];
              line.fromTo = composeFromTo(from, to);
              if (!line.auto) line.direction = manualTransferDirection(line.fromTo, location === ALL ? '' : branchCode(location));
              return r;
            });
            const warning = manualTransferWarning(t, location === ALL ? '' : branchCode(location), report.transfers);
            return (
            <React.Fragment key={i}>
            <tr className={warning ? 'has-line-note' : undefined}>
              <td className="dr-transfer-no">
                {/* Which transfer(s) the line is, so the same one isn't
                    added twice (2026-10-15; it replaced the Count).
                    A ticket line shows its tickets' numbers — fix the
                    ticket, not the report. One added by hand types it. */}
                {t.auto ? (
                  // The ticket's own number, as text: fix the ticket,
                  // not the report.
                  <span className="dr-cell is-readonly is-left dr-transfer-no-text"
                    title="From the transfer tickets; change the ticket to change this">
                    {t.transferNumber || '—'}
                  </span>
                ) : (
                  <ReportCell value={t.transferNumber || ''} type="text" align="left"
                    disabled={locked} placeholder="Transfer #" ariaLabel="Transfer number"
                    className={warning?.code === 'number-on-report' ? 'is-odd' : ''}
                    onChange={(v) => patch(r => { r.transfers[i].transferNumber = cleanTransferNumber(v); return r; })} />
                )}
              </td>
              <td className="dr-route-cell">
                <span className="dr-direction" title={t.direction === 'in' ? 'Incoming' : 'Outgoing'}>
                  {t.direction === 'in' ? <ArrowDownToLine size={12} /> : <ArrowUpFromLine size={12} />}
                </span>
                <select className={`dr-cell dr-select ${t.auto ? 'is-derived' : ''}`}
                  value={fromCode} disabled={locked || t.auto} aria-label="Transfer from"
                  onChange={(e) => setRoute(e.target.value, toCode)}>
                  <option value="">From</option>
                  {routeLocations.map(l => <option key={l} value={branchCode(l)}>{compactRoutes ? branchCode(l) : l}</option>)}
                </select>
                <span className="dr-route-sep" aria-hidden="true">—</span>
                <select className={`dr-cell dr-select ${t.auto ? 'is-derived' : ''}`}
                  value={toCode} disabled={locked || t.auto} aria-label="Transfer to"
                  onChange={(e) => setRoute(fromCode, e.target.value)}>
                  <option value="">To</option>
                  {routeLocations.map(l => <option key={l} value={branchCode(l)}>{compactRoutes ? branchCode(l) : l}</option>)}
                </select>
              </td>
              <td className="dr-num">
                <ReportCell value={t.slabs} disabled={locked} ariaLabel="Transfer slabs"
                  className={outOfBand(slabRange, t.slabs) ? 'is-odd' : ''}
                  onKeyDown={rowKeys('transfers', i, addTransfer, !t.fromTo && !t.transferNumber && !n(t.slabs))}
                  onChange={(v) => patch(r => {
                    touchTransferSlabs(transferLineKey(t));
                    r.transfers[i].slabs = v;
                    return r;
                  })} />
              </td>
              <td className="dr-x">
                {/* Same for removing one: an auto line comes back from its
                    tickets on the next load, so only hand-added lines
                    get an X. Cancel the ticket to drop an auto line. */}
                {!locked && !t.auto && (
                  <button className="dr-rowdel" aria-label="Remove transfer"
                    onClick={() => patch(r => { r.transfers.splice(i, 1); return r; })}><X size={13} /></button>
                )}
              </td>
            </tr>
            {warning && (
              <tr className="dr-line-note">
                <td colSpan={4}>
                  <AlertTriangle size={12} aria-hidden="true" />
                  {transferWarningText(warning, location)}
                </td>
              </tr>
            )}
            </React.Fragment>
            );
          })}
          <tr className="dr-total">
            <td>Outgoing</td>
            <td />
            <td className="dr-num">{totals.transferSlabs}</td>
            <td className="dr-x" />
          </tr>
          <tr className="dr-total">
            <td>Incoming</td>
            <td />
            <td className="dr-num">{totals.transferSlabsIn}</td>
            <td className="dr-x" />
          </tr>
        </tbody>
      </table>
    </ReportSection>
  );
}
