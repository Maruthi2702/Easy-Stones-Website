import { Plus, ChevronLeft, ChevronRight } from 'lucide-react';
import { MAX_TRUCK_CAPACITY } from '../../../api/deliverySchedule';
import { dayLabel } from '../../../utils/deliveryWeek';
import { DAY_COL_WIDTH, MIN_TABLE_WIDTH, MIN_TRUCK_COL_WIDTH, countLabel, isCounterColumn, columnNoun, getCapacityColorClass } from './boardRules';
import type { DropSlot } from './boardRules';
import type { BoardColumn, Ticket } from '../types';

export type BoardTableProps = {
  weekDates: string[];
  todayStr: string;
  displayTrucks: BoardColumn[];
  tableScrollRef: React.RefObject<HTMLDivElement | null>;
  moreSide: { left: boolean; right: boolean };
  scrollColumns: (dir: number) => void;
  dragOverCellKey: string | null;
  setDragOverCellKey: React.Dispatch<React.SetStateAction<string | null>>;
  setDropSlot: React.Dispatch<React.SetStateAction<DropSlot | null>>;
  editable: boolean;
  onAddDelivery?: (truckId?: string | null, dateStr?: string | null) => void;
  onMoveDelivery?: unknown;
  handleDropOnCell: (trk: BoardColumn, dateStr: string, e: React.DragEvent) => void;
  getDeliveriesForCell: (truckId: string, dateStr: string) => Ticket[];
  getRawCapacity: (truckId: string, dateStr: string) => number;
  formatDaySubtext: (dateStr: string) => string;
  renderCellTickets: (trk: BoardColumn, dateStr: string, cellDeliveries: Ticket[], listClassName: string) => React.ReactNode;
};

/** The dispatch table (900px and wider): drivers across, days down, a drop target per cell. */
export default function BoardTable({
  weekDates, todayStr, displayTrucks, tableScrollRef, moreSide, scrollColumns, dragOverCellKey, setDragOverCellKey,
  setDropSlot, editable, onAddDelivery, onMoveDelivery, handleDropOnCell, getDeliveriesForCell, getRawCapacity,
  formatDaySubtext, renderCellTickets
}: BoardTableProps) {
  return (
    /* ── DISPATCH TABLE MATRIX ── */
    <div
      className={`board-scroll-frame${moreSide.left ? ' more-left' : ''}${moreSide.right ? ' more-right' : ''}`}
      style={{ '--day-col-width': `${DAY_COL_WIDTH}px` } as React.CSSProperties}
    >
    <div className="board-grid-scroll-container" ref={tableScrollRef}>
      {/* table-layout is fixed, so without a width that grows per driver the
          columns just divide the same 1100px and every extra driver squeezes
          the cards further. Give each driver a floor and let the container
          scroll sideways instead. */}
      <table
        className="manifest-dispatch-table"
        style={{ minWidth: `${Math.max(MIN_TABLE_WIDTH, DAY_COL_WIDTH + displayTrucks.length * MIN_TRUCK_COL_WIDTH)}px` }}
      >
        <colgroup>
          <col style={{ width: `${DAY_COL_WIDTH}px` }} />
          {displayTrucks.map(trk => <col key={trk.id || 'unassigned'} />)}
        </colgroup>
        <thead>
          <tr>
            <th className="day-col-header-row">
              <div className="th-day-inner"><span>Day</span></div>
            </th>
            {displayTrucks.map(trk => (
              <th
                key={trk.id || 'unassigned'}
                className="truck-col-header"
                style={{ '--truck-color': trk.color || '#D4AF37' } as React.CSSProperties}
              >
                <div className="truck-label-wrap">
                  <div className="truck-color-dot" style={{ background: trk.color || '#D4AF37' }} />
                  <div className="truck-text-details">
                    <span className="truck-name">{trk.driver || trk.name}</span>
                    {trk.inactive && <span className="truck-former-tag" title="Deactivated in Users & Roles — shown for the orders they had">Former</span>}
                    {trk.name && trk.driver && trk.name !== trk.driver && (
                      <span className="truck-driver">{trk.name}</span>
                    )}
                  </div>
                </div>
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {weekDates.map((dateStr) => {
            const isToday = dateStr === todayStr;

            return (
              <tr key={dateStr} className={`day-grid-row ${isToday ? 'today-row' : ''}`}>
                <td className={`day-info-cell ${isToday ? 'today-cell' : ''}`}>
                  <div className="day-label-wrap">
                    <span className="day-name">{dayLabel(dateStr).name}</span>
                    <span className="day-date">{formatDaySubtext(dateStr)}</span>
                  </div>
                </td>

                {displayTrucks.map(trk => {
                  const cellDeliveries = getDeliveriesForCell(trk.id, dateStr);
                  const rawCount = getRawCapacity(trk.id, dateStr);
                  const capClass = getCapacityColorClass(rawCount);

                  const cellKey = `${trk.id}_${dateStr}`;

                  return (
                    <td
                      key={trk.id}
                      className={`dispatch-cell ${dragOverCellKey === cellKey ? 'drop-target' : ''}`}
                      onDragOver={(e) => {
                        if (!onMoveDelivery || trk.inactive) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                      }}
                      onDragEnter={() => onMoveDelivery && !trk.inactive && setDragOverCellKey(cellKey)}
                      onDragLeave={() => {
                        if (!onMoveDelivery) return;
                        setDragOverCellKey(prev => (prev === cellKey ? null : prev));
                        setDropSlot(prev => (prev && prev.cellKey === cellKey ? null : prev));
                      }}
                      onDrop={(e) => handleDropOnCell(trk, dateStr, e)}
                    >
                      <div className="cell-header-bar">
                        <span
                          className={`cell-capacity-pill ${isCounterColumn(trk) ? 'capacity-ok-green' : capClass}`}
                          title={isCounterColumn(trk)
                            ? `${rawCount} customer ${columnNoun(trk)}${rawCount === 1 ? '' : 's'} booked`
                            : `${rawCount} of ${MAX_TRUCK_CAPACITY} stops booked on this truck`}
                        >
                          {countLabel(trk, rawCount)}
                        </span>
                        {editable && !trk.inactive && (
                          <button
                            type="button"
                            className="cell-add-btn"
                            onClick={() => onAddDelivery && onAddDelivery(trk.id, dateStr)}
                            title={isCounterColumn(trk)
                              ? `Add customer ${columnNoun(trk)} — ${dayLabel(dateStr).name}`
                              : `Add delivery — ${trk.driver} on ${dayLabel(dateStr).name}`}
                          >
                            <Plus size={14} />
                          </button>
                        )}
                      </div>

                      {renderCellTickets(trk, dateStr, cellDeliveries, 'cell-tickets-list')}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
      {moreSide.left && (
        <button type="button" className="board-more-btn is-left" onClick={() => scrollColumns(-1)} aria-label="Show the columns to the left" title="More columns to the left">
          <ChevronLeft size={18} />
        </button>
      )}
      {moreSide.right && (
        <button type="button" className="board-more-btn is-right" onClick={() => scrollColumns(1)} aria-label="Show the columns to the right" title="More columns to the right">
          <ChevronRight size={18} />
        </button>
      )}
    </div>
  );
}
