import React from 'react';
import { MapPin, User, Clock, FileText, Hash, Navigation } from 'lucide-react';
import StatusPill from './StatusPill';

/**
 * Highlight substring matches inside a text string with <mark> tags.
 */
function Highlight({ text = '', query = '' }) {
  if (!query || !text) return <>{text}</>;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase()
          ? <mark key={i} className="ticket-highlight">{part}</mark>
          : part
      )}
    </>
  );
}

const TicketChip = ({
  delivery,
  truckColor = '#D4AF37',
  onClick,
  editable = false,
  searchQuery = ''
}) => {
  if (!delivery) return null;

  const soVal = delivery.soNumber || delivery.invoiceNumber;
  const stopNum = delivery.routeNumber || 1;

  return (
    <div
      className={`manifest-ticket-chip ${editable ? 'clickable' : ''} status-border-${delivery.status || 'scheduled'}`}
      style={{ borderLeftColor: truckColor }}
      onClick={() => onClick && onClick(delivery)}
      title={editable ? 'Click to edit delivery' : delivery.customerName}
    >
      <div className="ticket-header">
        <span className="ticket-time-mono" title={`Stop #${stopNum}${soVal ? ` · SO #${soVal}` : ''}`}>
          <Navigation size={11} style={{ marginRight: 2 }} /> Stop #{stopNum}{soVal ? ` · SO #${soVal}` : ''}
        </span>
        <StatusPill status={delivery.status} size="small" />
      </div>

      <h5 className="ticket-customer">
        <Highlight text={delivery.customerName} query={searchQuery} />
      </h5>

      <p className="ticket-address">
        <MapPin size={12} />
        <Highlight text={delivery.address} query={searchQuery} />
      </p>

      <div className="ticket-footer">
        <span className="ticket-rep">
          <User size={11} />
          <Highlight text={delivery.salesRepName || 'Sales Rep'} query={searchQuery} />
        </span>
        {soVal && (
          <span className="stop-so-badge" title={`SO/Invoice #${soVal}`}>
            <Hash size={11} /> SO #{soVal}
          </span>
        )}
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
