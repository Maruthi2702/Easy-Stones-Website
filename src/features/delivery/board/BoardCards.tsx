import { Plus } from 'lucide-react';
// Day names come from the dates themselves — the board renders whichever days
// the week actually shows, which is Mon-Fri plus any weekend day in use.
import { dayLabel } from '../../../utils/deliveryWeek';
import { countLabel, isCounterColumn, columnNoun } from './boardRules';
import type { BoardColumn, Ticket } from '../types';

export type BoardCardsProps = {
  weekDates: string[];
  todayStr: string;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  deliveries: Ticket[];
  trucks: BoardColumn[];
  displayTrucks: BoardColumn[];
  totalStopsSelectedDay: number;
  editable: boolean;
  onAddDelivery?: (truckId?: string | null, dateStr?: string | null) => void;
  getDeliveriesForCell: (truckId: string, dateStr: string) => Ticket[];
  getRawCapacity: (truckId: string, dateStr: string) => number;
  renderCellTickets: (trk: BoardColumn, dateStr: string, cellDeliveries: Ticket[], listClassName: string) => React.ReactNode;
};

/** The board on phones and iPads (under 900px): day pills, then one card per driver for the picked day. */
export default function BoardCards({
  weekDates, todayStr, selectedDate, setSelectedDate, deliveries, trucks, displayTrucks,
  totalStopsSelectedDay, editable, onAddDelivery, getDeliveriesForCell, getRawCapacity, renderCellTickets
}: BoardCardsProps) {
  return (
    /* ── UX REDESIGN MOBILE LAYOUT ── */
    <div className="ux-mobile-schedule-container">

      {/* Day Selector Pills Bar */}
      <div className="ux-day-pills-bar">
        {weekDates.map((dateStr) => {
          const isSelected = selectedDate === dateStr;
          const isToday = dateStr === todayStr;
          const dayStopsCount = deliveries.filter(d => d.date === dateStr).length;

          return (
            <button
              key={dateStr}
              type="button"
              className={`ux-day-pill-card ${isSelected ? 'active' : ''} ${isToday ? 'is-today' : ''}`}
              onClick={() => setSelectedDate(dateStr)}
            >
              <span className="ux-pill-day-name">{dayLabel(dateStr).short.toUpperCase()}</span>
              <span className="ux-pill-date-num">{dateStr ? dateStr.split('-')[2] : ''}</span>
              <span className="ux-pill-stops-count">
                {isSelected ? 'Active' : (dayStopsCount > 0 ? `${dayStopsCount} ${dayStopsCount === 1 ? 'stop' : 'stops'}` : '0 stops')}
              </span>
            </button>
          );
        })}
      </div>

      {/* Day Subtext Summary */}
      <div className="ux-schedule-subtext">
        {trucks.length} {trucks.length === 1 ? 'truck' : 'trucks'} · {totalStopsSelectedDay} {totalStopsSelectedDay === 1 ? 'stop' : 'stops'} scheduled
      </div>

      {/* Driver Sections */}
      <div className="ux-driver-list">
        {displayTrucks.map(trk => {
          const trkDeliveries = getDeliveriesForCell(trk.id, selectedDate);
          const capCount = getRawCapacity(trk.id, selectedDate);

          return (
            <div
              key={trk.id || 'unassigned'}
              className="ux-driver-card"
              style={{ borderLeftColor: trk.color || '#D4AF37' }}
            >
              {/* Driver Header */}
              <div className="ux-driver-header">
                <div className="ux-driver-name-wrap">
                  <span className="ux-driver-dot" style={{ background: trk.color || '#D4AF37' }} />
                  <span className="ux-driver-name">{trk.driver || trk.name}</span>
                  {trk.inactive && <span className="truck-former-tag" title="Deactivated in Users & Roles — shown for the orders they had">Former</span>}
                </div>

                <div className="ux-driver-actions">
                  {/* Will calls and drop-offs are moved by the customer, so
                      the daily truck load does not apply — count them,
                      don't cap them. */}
                  <span className={`ux-capacity-badge ${capCount > 0 ? 'has-stops' : 'empty'}`}>
                    {countLabel(trk, capCount)}
                  </span>
                  {editable && !trk.inactive && (
                    <button
                      type="button"
                      className="ux-btn-add-stop"
                      onClick={() => onAddDelivery && onAddDelivery(trk.id, selectedDate)}
                      title={isCounterColumn(trk)
                        ? `Add a customer ${columnNoun(trk)}`
                        : `Add stop for ${trk.driver}`}
                    >
                      <Plus size={14} /> Add {columnNoun(trk)}
                    </button>
                  )}
                </div>
              </div>

              {/* Driver Delivery Ticket Cards */}
              {trkDeliveries.length === 0 ? (
                <div className="ux-no-stops-text">
                  No {columnNoun(trk)}s scheduled
                </div>
              ) : (
                renderCellTickets(trk, selectedDate, trkDeliveries, 'ux-tickets-list')
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
