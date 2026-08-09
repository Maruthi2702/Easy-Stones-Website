import React from 'react';
import { Users, Truck, PackagePlus, ArrowLeftRight, Wallet } from 'lucide-react';
import { money, moneyShort, STATUS } from './summaryFigures';

/**
 * The six figures a day is summarised by, and the table that lists them.
 *
 * A month lists them per day and "All locations" lists them per branch — the
 * same columns in the same order either way, so the two read as one view of the
 * business rather than two reports that happen to share a tab. Only the leading
 * column differs, which is what `lead` is for.
 */

export const StatusChip = ({ status, title }) => {
  const s = STATUS[status] || STATUS.draft;
  return (
    <span className={`dr-status dr-status--${s.cls}`} title={title}>
      <s.Icon size={11} /> {s.label}
    </span>
  );
};

/**
 * The same five tiles the day view opens with, over a wider span. Deliveries
 * and pick-ups share a tile there, so they share one here too.
 */
export const SummaryStats = ({ totals, visitorsNote, paymentsNote }) => {
  const tiles = [
    { key: 'visitors', icon: Users, label: 'Visitors', value: totals.visitors, sub: visitorsNote },
    {
      key: 'deliveries',
      icon: Truck,
      label: 'Deliveries',
      value: totals.deliveries + totals.pickups,
      sub: `${totals.deliveries} out · ${totals.pickups} picked up`
    },
    {
      key: 'in',
      icon: PackagePlus,
      label: 'Slabs in',
      value: totals.containerSlabs,
      sub: totals.containerSlabs ? 'from containers' : 'no containers'
    },
    {
      key: 'out',
      icon: ArrowLeftRight,
      label: 'Slabs out',
      value: totals.transferSlabs,
      sub: totals.transferSlabs ? 'on transfers' : 'no transfers'
    },
    {
      key: 'payments',
      icon: Wallet,
      label: 'Payments',
      value: moneyShort(totals.payments),
      sub: paymentsNote,
      accent: true
    }
  ];

  return (
    <div className="dr-stats">
      {tiles.map(t => (
        <div key={t.key} className={`dr-stat ${t.accent ? 'is-accent' : ''}`}>
          <div className="dr-stat-lab"><t.icon size={12} /> {t.label}</div>
          <div className="dr-stat-val">{t.value}</div>
          <div className="dr-stat-sub">{t.sub}</div>
        </div>
      ))}
    </div>
  );
};

/**
 * lead      — the columns before the figures: [{ header, render, className }]
 * rows      — summary rows from the API
 * totals    — the foot row's figures; the label sits under the first lead column
 * onRowClick, rowKey — a row is a way in to the day it describes
 */
const SummaryTable = ({ lead, rows, totals, totalLabel, onRowClick, rowKey, rowTitle }) => (
  <div className="dr-card">
    <div className="dr-table-scroll">
      <table className="dr-table dr-table--month">
        <thead>
          <tr>
            {lead.map(c => <th key={c.header}>{c.header}</th>)}
            <th className="dr-num">Visitors</th>
            <th className="dr-num">Deliveries</th>
            <th className="dr-num">Pick-ups</th>
            <th className="dr-num">Transfer slabs</th>
            <th className="dr-num">Container slabs</th>
            <th className="dr-num">Payments</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr
              key={rowKey(r)}
              /* A day nobody opened recedes rather than shouts — it is a gap in
                 the record, not a problem with the day. */
              className={`dr-monthrow ${r.status === 'none' ? 'is-idle' : ''}`}
              onClick={() => onRowClick(r)}
              /* A row is a link in all but markup — it opens the sheet it
                 describes, so it answers the keyboard like one. */
              tabIndex={0}
              role="button"
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onRowClick(r);
                }
              }}
              title={rowTitle ? rowTitle(r) : undefined}
            >
              {lead.map(c => (
                <td key={c.header} className={c.className}>{c.render(r)}</td>
              ))}
              <td className="dr-num">{r.visitors || '—'}</td>
              <td className="dr-num">{r.deliveries || '—'}</td>
              <td className="dr-num">{r.pickups || '—'}</td>
              <td className="dr-num">{r.transferSlabs || '—'}</td>
              <td className="dr-num">{r.containerSlabs || '—'}</td>
              <td className="dr-num">{r.payments ? money(r.payments) : '—'}</td>
              <td>
                <StatusChip
                  status={r.status}
                  title={r.autoSubmitted
                    ? 'submitted automatically at 11:59 PM'
                    : (r.submittedBy ? `by ${r.submittedBy}` : undefined)}
                />
              </td>
            </tr>
          ))}
          <tr className="dr-total">
            <td>{totalLabel}</td>
            {lead.slice(1).map(c => <td key={c.header} />)}
            <td className="dr-num">{totals.visitors}</td>
            <td className="dr-num">{totals.deliveries}</td>
            <td className="dr-num">{totals.pickups}</td>
            <td className="dr-num">{totals.transferSlabs}</td>
            <td className="dr-num">{totals.containerSlabs}</td>
            <td className="dr-num">{money(totals.payments)}</td>
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  </div>
);

export default SummaryTable;
