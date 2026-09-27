import React, { useState } from 'react';
import { XCircle } from 'lucide-react';
import TicketChip from './TicketChip';

/**
 * Orders someone has cancelled. Sits below Pending Deliveries on every week —
 * a delivery lands here the moment it's dragged onto this section, and comes
 * back out the same way Pending already works: drag it onto a truck cell to
 * assign a driver, or onto Pending to leave it driverless. Either move clears
 * the cancelled status server-side (see PATCH /deliveries/:id/assignment in
 * src/routes/deliveries.js) — nothing here has to know that happened, it just
 * stops appearing in `cancelled` once the cache updates.
 *
 * Unlike Pending, cancelling never clears truckId/date — they're kept as a
 * record of what to restore the ticket to, which is exactly what dragging it
 * back onto a truck cell relies on.
 */
const CancelledOrders = ({
  cancelled = [],
  searchQuery = '',
  editable = false,
  onEditDelivery,
  onViewPod,
  onMoveToCancelled
}) => {
  const [isDropTarget, setIsDropTarget] = useState(false);
  const acceptsDrop = Boolean(editable && onMoveToCancelled);

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDropTarget(false);
    if (!acceptsDrop) return;
    const deliveryId = e.dataTransfer.getData('text/plain');
    if (!deliveryId) return;
    // Dropped back on the list it came from — nothing to change.
    if (cancelled.some(d => d.id === deliveryId)) return;
    onMoveToCancelled(deliveryId);
  };

  const visible = cancelled.filter(d => {
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
      className={`cancelled-orders-section ${isDropTarget ? 'drop-target' : ''}`}
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
      <header className="cancelled-orders-header">
        <span className="cancelled-orders-title">
          <XCircle size={15} />
          Cancelled Orders
          <span className="cancelled-orders-count">{visible.length}</span>
        </span>
        <span className="cancelled-orders-hint">
          {acceptsDrop
            ? 'Drag a ticket here to cancel it — drag it back onto a truck or Pending to restore it'
            : 'Orders that have been cancelled'}
        </span>
      </header>

      {visible.length === 0 ? (
        <p className="cancelled-orders-empty">
          {cancelled.length === 0
            ? 'Nothing cancelled.'
            : 'No cancelled orders match this search.'}
        </p>
      ) : (
        <div className="cancelled-orders-list">
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

export default CancelledOrders;
