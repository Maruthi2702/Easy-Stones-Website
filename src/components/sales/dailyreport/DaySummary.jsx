import React from 'react';
import { Users, Truck, PackagePlus, ArrowLeftRight, Wallet, Check } from 'lucide-react';
import { moneyShort } from './summaryFigures';

/**
 * The day at a glance — the five figures anyone asks about, above the form
 * that produces them. These are the same five the month view lists per row, so
 * a day and a month describe themselves the same way.
 *
 * The completeness line underneath is a nudge, not a gate: a branch that really
 * took no money has a legitimate zero, and the report should never refuse to be
 * signed off over it.
 */

const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;

const spoken = (...values) => values.some(v => v !== null && v !== undefined && v !== '');

/**
 * A line the user has started saying something on. A row added but not yet
 * typed into is not a container — counting it would have the tiles claim a
 * delivery the branch never received, and it is dropped on save anyway.
 */
const hasContent = (line) =>
  Boolean(line.poNumber || line.material || line.fromTo) || spoken(line.count, line.slabs);

const DaySummary = ({ report, totals, canSubmit, onSubmit, submitting = false }) => {
  if (!report || !totals) return null;

  const v = report.visitors;
  const submitted = report.status === 'submitted';
  const containerLines = report.containers.filter(hasContent).length;
  const transferLines = report.transfers.filter(hasContent).length;

  const tiles = [
    {
      key: 'visitors',
      icon: Users,
      label: 'Visitors',
      value: totals.visitors,
      sub: [
        Number(v.homeowners) ? `${v.homeowners} homeowner${Number(v.homeowners) === 1 ? '' : 's'}` : null,
        Number(v.fabricators) ? `${v.fabricators} fabricator${Number(v.fabricators) === 1 ? '' : 's'}` : null,
        Number(v.designers) ? `${v.designers} designer${Number(v.designers) === 1 ? '' : 's'}` : null
      ].filter(Boolean).join(' · ') || 'none recorded'
    },
    {
      key: 'deliveries',
      icon: Truck,
      label: 'Deliveries',
      value: totals.assigned,
      // Slabs are counted alongside the deliveries, not out of them — a
      // count, never a ratio, so it reads underneath rather than as "16/24".
      sub: totals.capacity ? `${totals.capacity} slabs` : 'no slabs counted yet'
    },
    {
      key: 'in',
      icon: PackagePlus,
      label: 'Slabs in',
      value: totals.containerSlabs,
      sub: containerLines ? plural(containerLines, 'container') : 'no containers'
    },
    {
      key: 'out',
      icon: ArrowLeftRight,
      label: 'Slabs out',
      value: totals.transferSlabs,
      sub: transferLines ? plural(transferLines, 'transfer') : 'no transfers'
    },
    {
      key: 'payments',
      icon: Wallet,
      label: 'Payments',
      value: moneyShort(totals.payAmount),
      sub: totals.payCount ? plural(totals.payCount, 'transaction') : 'none recorded',
      accent: true
    }
  ];

  // "Filled" means somebody said something — including saying nothing was taken.
  // Counting only figures above zero left a genuine nil day permanently
  // incomplete, which is exactly the day most likely to be forgotten.
  const said = spoken;
  const p = report.payments;
  const sections = [
    { name: 'visitors', filled: said(v.fabricators, v.designers) || totals.visitors > 0 },
    { name: 'deliveries', filled: said(report.deliveries.capacity, report.pickups.capacity, report.returns, report.sinks) || totals.assigned > 0 },
    { name: 'transfers', filled: transferLines > 0 },
    { name: 'containers', filled: containerLines > 0 },
    { name: 'payments', filled: said(p.cash.count, p.cash.amount, p.card.count, p.card.amount, p.check.count, p.check.amount) }
  ];
  const done = sections.filter(s => s.filled).length;
  const blank = sections.filter(s => !s.filled).map(s => s.name);
  const pct = Math.round((done / sections.length) * 100);

  const blankLabel = blank.length === 0
    ? 'Every section has figures.'
    : `${blank.slice(0, -1).join(', ')}${blank.length > 1 ? ' and ' : ''}${blank[blank.length - 1]} still blank`;

  return (
    <>
      <div className="dr-stats">
        {tiles.map(t => (
          <div key={t.key} className={`dr-stat ${t.accent ? 'is-accent' : ''}`}>
            <div className="dr-stat-lab"><t.icon size={12} /> {t.label}</div>
            <div className="dr-stat-val">
              {t.value}
              {t.suffix && <span className="dr-stat-suffix">{t.suffix}</span>}
            </div>
            <div className="dr-stat-sub">{t.sub}</div>
          </div>
        ))}
      </div>

      <div className="dr-progress">
        <span className="dr-progress-count">{done} of {sections.length} sections filled</span>
        <span className="dr-progress-track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <span className="dr-progress-fill" style={{ width: `${pct}%` }} />
        </span>
        <span className="dr-progress-blank">{blankLabel}</span>
        {submitted ? (
          <span className="dr-progress-done">
            <Check size={13} /> {report.autoSubmitted ? 'Submitted automatically' : 'Submitted'}
          </span>
        ) : canSubmit && (
          <button type="button" className="dr-btn dr-btn--gold dr-progress-submit" onClick={onSubmit} disabled={submitting}>
            <Check size={14} /> Submit day
          </button>
        )}
      </div>
    </>
  );
};

export default DaySummary;
