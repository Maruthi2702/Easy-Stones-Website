import React from 'react';
import { Clock, Plus } from 'lucide-react';
import TicketChip from './TicketChip';

/**
 * Orders that are ready to go but have no date agreed with the customer yet.
 * They belong to no week, so this list sits beneath the board on every week —
 * a delivery leaves it the moment it is given a date.
 */
const PendingDeliveries = ({
  pending = [],
  searchQuery = '',
  editable = false,
  onAddPending,
  onEditDelivery,
  onViewPod
}) => {
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
    <section className="pending-deliveries-section">
      <header className="pending-deliveries-header">
        <span className="pending-deliveries-title">
          <Clock size={15} />
          Pending Delivery
          <span className="pending-deliveries-count">{visible.length}</span>
        </span>
        <span className="pending-deliveries-hint">Awaiting a date from the customer</span>
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
            ? 'Nothing pending — every order has a date.'
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
