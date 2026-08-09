import React from 'react';
import { Users, Truck, PackagePlus, ArrowLeftRight, Wallet, Check } from 'lucide-react';

/**
 * The day at a glance — the five figures anyone asks about, above the form
 * that produces them. These are the same five the month view lists per row, so
 * a day and a month describe themselves the same way.
 *
 * The completeness line underneath is a nudge, not a gate: a branch that really
 * took no money has a legitimate zero, and the report should never refuse to be
 * signed off over it.
 */

const money = (v) => `$${Number(v || 0).toLocaleString('en-US', {
  minimumFractionDigits: Number(v || 0) % 1 ? 2 : 0,
  maximumFractionDigits: 2
})}`;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;

const DaySummary = ({ report, totals, canSubmit, onSubmit, submitting = false }) => {
  if (!report || !totals) return null;

  const v = report.visitors;
  const submitted = report.status === 'submitted';

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
      // Capacity only means something once it has been entered.
      // The gap is the margin on .dr-stat-suffix, not a space in the string.
      suffix: totals.capacity ? `/${totals.capacity}` : null,
      sub: totals.capacity ? 'of capacity' : 'capacity not set'
    },
    {
      key: 'in',
      icon: PackagePlus,
      label: 'Slabs in',
      value: totals.containerSlabs,
      sub: report.containers.length ? plural(report.containers.length, 'container') : 'no containers'
    },
    {
      key: 'out',
      icon: ArrowLeftRight,
      label: 'Slabs out',
      value: totals.transferSlabs,
      sub: report.transfers.length ? plural(report.transfers.length, 'transfer') : 'no transfers'
    },
    {
      key: 'payments',
      icon: Wallet,
      label: 'Payments',
      value: money(totals.payAmount),
      sub: totals.payCount ? plural(totals.payCount, 'transaction') : 'none recorded',
      accent: true
    }
  ];

  // "Filled" means something was recorded, not that it was validated.
  const sections = [
    { name: 'visitors', filled: totals.visitors > 0 },
    { name: 'deliveries', filled: totals.assigned > 0 || totals.capacity > 0 },
    { name: 'transfers', filled: report.transfers.length > 0 },
    { name: 'containers', filled: report.containers.length > 0 },
    { name: 'payments', filled: totals.payCount > 0 || totals.payAmount > 0 }
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
          <span className="dr-progress-done"><Check size={13} /> Submitted</span>
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
