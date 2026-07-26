import React from 'react';
import { MapPin, User, Clock, FileText } from 'lucide-react';
import StatusPill from './StatusPill';

const TicketChip = ({
  delivery,
  truckColor = '#D4AF37',
  onClick,
  editable = false
}) => {
  if (!delivery) return null;

  return (
    <div
      className={`manifest-ticket-chip ${editable ? 'clickable' : ''}`}
      style={{ borderLeftColor: truckColor }}
      onClick={() => onClick && onClick(delivery)}
      title={editable ? 'Click to edit delivery' : delivery.customerName}
    >
      <div className="ticket-header">
        <span className="ticket-time-mono">
          <Clock size={12} /> {delivery.time || 'TBD'}
        </span>
        <StatusPill status={delivery.status} size="small" />
      </div>

      <h5 className="ticket-customer">{delivery.customerName}</h5>

      <p className="ticket-address">
        <MapPin size={12} /> {delivery.address}
      </p>

      <div className="ticket-footer">
        <span className="ticket-rep">
          <User size={11} /> {delivery.salesRepName || 'Sales Rep'}
        </span>
        {delivery.notes && (
          <span className="ticket-has-notes" title={delivery.notes}>
            <FileText size={11} /> Notes
          </span>
        )}
      </div>
    </div>
  );
};

export default TicketChip;
