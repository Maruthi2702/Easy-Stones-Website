import React, { useState } from 'react';
import { MapPin, User, Clock, FileText, Hash, Navigation, Copy, Check } from 'lucide-react';
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
  const [copied, setCopied] = useState(false);

  if (!delivery) return null;

  const soVal = delivery.soNumber || delivery.invoiceNumber;
  const stopNum = delivery.routeNumber || 1;

  const handleCopySO = (e, val) => {
    e.stopPropagation();
    if (!val) return;
    try {
      navigator.clipboard.writeText(val);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (err) {
      console.warn('Clipboard copy failed:', err);
    }
  };

  return (
    <div
      className={`manifest-ticket-chip ${editable ? 'clickable' : ''} status-border-${delivery.status || 'scheduled'}`}
      style={{ borderLeftColor: truckColor }}
      onClick={() => onClick && onClick(delivery)}
      title={editable ? 'Click to edit delivery' : delivery.customerName}
    >
      <div className="ticket-header">
        <span className="ticket-time-mono">
          <Navigation size={11} style={{ marginRight: 2 }} /> Stop #{stopNum}
          {soVal && (
            <span
              className={`so-header-inline-text ${copied ? 'copied' : ''}`}
              onClick={(e) => handleCopySO(e, soVal)}
              title={copied ? 'Copied to clipboard!' : 'Click to copy SO#'}
            >
              {' | SO# '}
              <span className="so-num-highlight">{soVal}</span>
              {copied ? (
                <Check size={11} className="so-copy-icon success" />
              ) : (
                <Copy size={11} className="so-copy-icon" />
              )}
            </span>
          )}
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
