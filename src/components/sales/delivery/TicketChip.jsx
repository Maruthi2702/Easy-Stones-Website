import React, { useState } from 'react';
import { MapPin, User, Clock, FileText, Hash, Navigation, Copy, Check, Repeat } from 'lucide-react';
import StatusPill from './StatusPill';
import EpodChip from './EpodChip';

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
  searchQuery = '',
  onViewPod
}) => {
  const [copied, setCopied] = useState(false);

  if (!delivery) return null;

  const soVal = delivery.soNumber || delivery.invoiceNumber;
  const stopNum = delivery.routeNumber || 1;

  // A branch transfer has no customer, jobsite address, route stop or sales rep,
  // so those slots would render as a bare "Stop #1", an orphan map pin and a
  // leftover rep name. Show the transfer's own details instead.
  const isTransfer = delivery.deliveryType === 'transfer';
  // The title line already reads "Transfer -> <branch>", so the header says
  // "Transfer# 14322" rather than repeating the word and wrapping in a narrow
  // truck column.
  const refLabel = isTransfer ? '' : '| SO# ';
  const showRep = !isTransfer;
  // Proof only means something once the delivery is done — an unsigned scheduled
  // job doesn't need telling that it has no ePOD yet.
  const showEpod = delivery.status === 'completed';
  const hasFooter = showRep || Boolean(delivery.notes) || showEpod;

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
          {isTransfer ? (
            <><Repeat size={11} style={{ marginRight: 2 }} />{soVal ? 'Transfer#' : 'Transfer'}</>
          ) : (
            <><Navigation size={11} style={{ marginRight: 2 }} /> Stop #{stopNum}</>
          )}
          {soVal && (
            <span
              className={`so-header-inline-text ${copied ? 'copied' : ''}`}
              onClick={(e) => handleCopySO(e, soVal)}
              title={copied ? 'Copied to clipboard!' : `Click to copy ${isTransfer ? 'Transfer#' : 'SO#'}`}
            >
              {refLabel}
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

      {delivery.address && (
        <p className="ticket-address">
          <MapPin size={12} />
          <Highlight text={delivery.address} query={searchQuery} />
        </p>
      )}

      {hasFooter && (
      <div className="ticket-footer">
        {showRep && (
          <span className="ticket-rep">
            <User size={11} />
            <Highlight text={delivery.salesRepName || 'Sales Rep'} query={searchQuery} />
          </span>
        )}
        {delivery.notes && (
          <span className="ticket-has-notes" title={delivery.notes}>
            <FileText size={11} /> Notes
          </span>
        )}
        {showEpod && <EpodChip delivery={delivery} onViewPod={onViewPod} />}
      </div>
      )}
    </div>
  );
};

export default TicketChip;
