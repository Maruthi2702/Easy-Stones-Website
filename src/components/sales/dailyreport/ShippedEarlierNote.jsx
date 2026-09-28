import React from 'react';
import { Info, AlertTriangle } from 'lucide-react';
import { shortDayLabel } from '../../../utils/deliveryTypes';

const isoToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const listOf = (items) =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

const PENDING_LABEL = { missing: 'Not filed yet', draft: 'Not submitted yet' };

/**
 * Why the delivery board shows more transfers on this day than the Transfers
 * section counts: the extra cards shipped in an earlier week and are drawn on
 * their arrival day. Each ship day links to its own report, flagged when that
 * report hasn't been filed or submitted, since that's the one counting them.
 */
const ShippedEarlierNote = ({ groups, date, onOpenDay }) => {
  const count = groups.reduce((s, g) => s + g.count, 0);
  const slabs = groups.reduce((s, g) => s + g.slabs, 0);
  const isToday = date === isoToday();
  const board = isToday ? "today's board" : `the board for ${shortDayLabel(date)}`;
  const arrive = isToday ? 'arrive today' : 'arrive that day';
  const shipped = listOf(groups.map(g => shortDayLabel(g.shipDate)));

  return (
    <span className="dr-shipped-earlier">
      <Info size={13} className="dr-shipped-earlier-icon" aria-hidden="true" />
      <span className="dr-shipped-earlier-body">
        <span>
          {count} {count === 1 ? 'transfer' : 'transfers'} on {board} {arrive} but shipped {shipped}
          {slabs > 0 && ` (${slabs} ${slabs === 1 ? 'slab' : 'slabs'})`}.
          {' '}{groups.length === 1 ? "They're counted on that day's report" : "They're counted on the reports for those days"}, not this one.
        </span>
        <span className="dr-shipped-earlier-links">
          {groups.map(g => (
            <span key={g.shipDate} className="dr-shipped-earlier-link">
              <button type="button" className="dr-link-btn" onClick={() => onOpenDay(g.shipDate)}>
                Open {shortDayLabel(g.shipDate)} report
              </button>
              {PENDING_LABEL[g.reportStatus] && (
                <span className="dr-shipped-earlier-status">
                  <AlertTriangle size={11} aria-hidden="true" /> {PENDING_LABEL[g.reportStatus]}
                </span>
              )}
            </span>
          ))}
        </span>
      </span>
    </span>
  );
};

export default ShippedEarlierNote;
