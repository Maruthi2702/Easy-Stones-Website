import React, { useState } from 'react';
import { Clock, Plus } from 'lucide-react';
import TicketChip from './TicketChip';

/**
 * Orders with no driver assigned yet. They have no truck column to sit in, so
 * this list sits beneath the board on every week — a delivery leaves it the
 * moment a driver is chosen, and comes back if one is unassigned.
 *
 * This list is also a drop target, not just an output: dragging a ticket from
 * a truck column onto it un-assigns the driver, the exact reverse of dropping
 * a pending ticket onto a cell. Without that the board is a one-way door —
 * a delivery scheduled to the wrong driver can only be put back by opening
 * the edit modal and blanking the driver by hand.
 */
const PendingDeliveries = ({
  pending = [],
  searchQuery = '',
  editable = false,
  onAddPending,
  onEditDelivery,
  onViewPod,
  onMoveToPending
}) => {
  const [isDropTarget, setIsDropTarget] = useState(false);
  const acceptsDrop = Boolean(editable && onMoveToPending);

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDropTarget(false);
    if (!acceptsDrop) return;
    const deliveryId = e.dataTransfer.getData('text/plain');
    if (!deliveryId) return;
    // Dropped back on the list it came from — nothing to change.
    if (pending.some(d => d.id === deliveryId)) return;
    onMoveToPending(deliveryId);
  };

  const visible = pending.filter(d => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      d.customerName?.toLowerCase().includes(q) ||
      d.address?.toLowerCase().includes(q) ||
      d.salesRepName?.toLowerCase().includes(q) ||
      d.soNumber?.toLowerCase().includes(q) ||
      d.invoiceNumber?.toLowerCase().includes(q)
    );
  });

  return (
    <section
      className={`pending-deliveries-section ${isDropTarget ? 'drop-target' : ''}`}
      onDragOver={(e) => {
        if (!acceptsDrop) return;
        // Without preventDefault the browser refuses the drop outright and
        // the ticket animates back to where it started.
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }}
      onDragEnter={() => acceptsDrop && setIsDropTarget(true)}
      onDragLeave={(e) => {
        // dragleave also fires when the pointer crosses between this
        // section's own children, which would flicker the highlight off
        // mid-drag — ignore those and only clear when the pointer has
        // actually left the section.
        if (e.currentTarget.contains(e.relatedTarget)) return;
        setIsDropTarget(false);
      }}
      onDrop={handleDrop}
    >
      <header className="pending-deliveries-header">
        <span className="pending-deliveries-title">
          <Clock size={15} />
          Pending Delivery
          <span className="pending-deliveries-count">{visible.length}</span>
        </span>
        <span className="pending-deliveries-hint">
          {acceptsDrop
            ? 'Awaiting a driver — drag a ticket here to take it off the board'
            : 'Awaiting a driver and date from the customer'}
        </span>
        {editable && (
          <button
            type="button"
            className="pending-add-btn"
            onClick={() => onAddPending && onAddPending()}
            title="Add an order that has no delivery date yet"
          >
            <Plus size={14} /> Add
          </button>
        )}
      </header>

      {visible.length === 0 ? (
        <p className="pending-deliveries-empty">
          {pending.length === 0
            ? 'Nothing pending — every order has a driver assigned.'
            : 'No pending orders match this search.'}
        </p>
      ) : (
        <div className="pending-deliveries-list">
          {visible.map(d => (
            <TicketChip
              key={d.id}
              delivery={d}
              truckColor="#94a3b8"
              editable={editable}
              searchQuery={searchQuery}
              onClick={editable ? onEditDelivery : undefined}
              onViewPod={onViewPod}
            />
          ))}
        </div>
      )}
    </section>
  );
};

export default PendingDeliveries;
