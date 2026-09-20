// The delivery card itself — rendered by both BoardGrid.jsx (office/sales
// board) and PendingDeliveries.jsx (undated/unassigned orders). StatusPill
// and EpodChip are its two small sub-badges, kept as separate files since
// each is reused/tested independently of the full card.
import React, { useState } from 'react';
import { MapPin, User, Clock, FileText, Hash, Navigation, Copy, Check, Repeat, PackageCheck, Truck, PenLine, Undo2, Layers } from 'lucide-react';
import StatusPill from './StatusPill';
import EpodChip from './EpodChip';
import { isCounterReturn } from '../../../utils/deliveryTypes';

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

// SPS has no public URL that opens a specific Sales Order by its SO# — its
// search box resolves SO# -> internal record ID client-side, then navigates
// there itself (confirmed by watching it happen: typing an SO# shows a
// matching autocomplete result, and clicking it lands on
// vSaleOrder.aspx?ID=<internal id>, a different number from the SO#). So this
// can only get the user to SPS's search box with the number already on their
// clipboard, not open the order directly. A named target reuses the same
// tab across repeated clicks instead of piling up a new one per SO copied.
const SPS_SEARCH_URL = 'https://easystones.stoneprofits.com/vSalesHome.aspx';
const SPS_TAB_NAME = 'easystones_sps';

// Returns are the one ticket on the board where material comes back to us
// instead of going out, and the cost of missing that is a driver loading a
// truck for a stop they were meant to collect from. Red because it has to be
// readable as "not a normal delivery" from across the room, before anyone
// reads a word of the card. Matches the red used for Hold in Inventory
// Analysis, so the two screens mean the same thing by it.
const RETURN_ACCENT = '#ef4444';

const TicketChip = ({
  delivery,
  truckColor = '#D4AF37',
  onClick,
  editable = false,
  searchQuery = '',
  onViewPod,
  // Only supplied for tickets that are collected rather than delivered — the
  // board decides that per column and leaves it off everywhere else, so a
  // normal stop stays the driver's to sign for.
  onOpenPod
}) => {
  const [copied, setCopied] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  if (!delivery) return null;

  const soVal = delivery.soNumber || delivery.invoiceNumber;
  const stopNum = delivery.routeNumber || 1;

  // A branch transfer has no customer, jobsite address, route stop or sales rep,
  // so those slots would render as a bare "Stop #1", an orphan map pin and a
  // leftover rep name. Show the transfer's own details instead.
  const isTransfer = delivery.deliveryType === 'transfer';
  // A will call is collected by the customer: it is nobody's stop on a route, so
  // the header says so instead of claiming a stop number it does not have.
  const isWillCall = delivery.deliveryType === 'will_call';
  // A return runs the other way — material coming back to us. Called out under
  // the address rather than in the header, because "Stop #2" on a driver's run
  // gives no hint that the truck is collecting rather than dropping off, and
  // that is the one thing the driver needs to know before they get there.
  const isReturnTicket = delivery.deliveryType === 'return';
  // A transfer's header already carries the word, so the number follows it bare
  // ("Transfer# 18311") rather than saying it twice — which on the narrowest
  // columns is the difference between the number fitting and not.
  const refLabel = isTransfer ? '' : 'SO# ';
  const showRep = !isTransfer;
  const isSigned = Boolean(delivery.pod?.verified);
  // Signed once, then voided. It still needs a signature, but more urgently than
  // one that was never signed at all — the ticket claims to be proven and isn't.
  const wasCleared = Boolean(delivery.pod?.clearedAt) && !isSigned;

  // Nobody drives a pickup, so its signature is captured at the counter by
  // whoever releases it. Offered until there is proof rather than until the
  // ticket is completed: a pickup someone marked complete by hand still has
  // nobody's signature on it, and a cleared ePOD has to be re-signed by the
  // same counter that took the first one.
  const canSign = Boolean(editable && onOpenPod && !isSigned);

  // A signed-for delivery keeps its driver/column fixed — dragging it to
  // reassign after the fact would misrepresent who actually delivered it.
  // A card showing its expected-arrival date rather than its real ship date
  // (see the list route in server.js) can't be dragged either — a truck
  // reassignment PATCH always writes the ship date, which would silently
  // overwrite it with whatever day the card was dropped on. Still fully
  // editable via its own modal, where both dates are what they really are.
  const canDrag = Boolean(editable && delivery.status !== 'completed' && !delivery.isIncomingView);

  // Proof only means something once the delivery is done — an unsigned scheduled
  // job doesn't need telling that it has no ePOD yet. Suppressed entirely where
  // the Sign button is offered: "Awaiting re-sign" beside "Sign ePOD" is the
  // same sentence twice, and two pills is more than a truck column can hold.
  const showEpod = delivery.status === 'completed' && !canSign;
  const hasFooter = showRep || Boolean(delivery.notes) || showEpod || canSign;

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
    // window.open must stay in the same synchronous click handler as the
    // triggering click, not chained after an awaited clipboard write —
    // Safari in particular only allows a popup opened during the original
    // user-gesture call stack, not one opened from a .then() a tick later.
    window.open(SPS_SEARCH_URL, SPS_TAB_NAME);
  };

  return (
    <div
      className={`manifest-ticket-chip ${editable ? 'clickable' : ''} ${isDragging ? 'dragging' : ''} ${isReturnTicket ? 'return-chip' : ''} status-border-${delivery.status || 'scheduled'}`}
      // The accent has to be set here rather than left to .return-chip in CSS:
      // this inline colour is what paints the truck's colour on every other
      // ticket, and an inline style beats any stylesheet rule, so a CSS-only
      // version would simply never show.
      style={{ borderLeftColor: isReturnTicket ? RETURN_ACCENT : truckColor }}
      onClick={() => onClick && onClick(delivery)}
      title={editable ? 'Click to edit delivery' : delivery.customerName}
      draggable={canDrag}
      onDragStart={(e) => {
        if (!canDrag) return;
        e.dataTransfer.setData('text/plain', delivery.id);
        // The board needs the ticket's type to work out what dropping it in a
        // given column means. Carried on the drag rather than looked up from
        // props at drop time: reading the deliveries list inside the drop
        // handler is enough to cost the board its React Compiler optimization.
        e.dataTransfer.setData('application/x-delivery-type', delivery.deliveryType || 'jobsite');
        e.dataTransfer.effectAllowed = 'move';
        setIsDragging(true);

        // Replaces the browser's default drag image — a full-size, semi
        // transparent snapshot of this entire card — with a small pill.
        // That default ghost is not part of the page: it is painted by the
        // browser's own drag engine on top of everything, so no z-index on
        // the drop-hint label underneath it could ever win. Dragging a card
        // as large as this one meant the ghost routinely covered the exact
        // spot — and the exact label — a dispatcher was hovering over.
        const ghost = document.createElement('div');
        ghost.className = 'drag-ghost-pill';
        ghost.textContent = `${isTransfer ? (soVal ? 'Transfer#' : 'Transfer') : `Stop #${stopNum}`} · ${delivery.customerName || 'Delivery'}`;
        // Off-screen rather than hidden — display:none or visibility:hidden
        // stop the browser from rasterizing an element at all, which is
        // exactly what setDragImage needs it for.
        ghost.style.position = 'fixed';
        ghost.style.top = '-999px';
        ghost.style.left = '-999px';
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, 14, 14);
        // The browser captures the image synchronously as part of this same
        // call, so the node only needs to survive until the next tick.
        setTimeout(() => ghost.remove(), 0);
      }}
      onDragEnd={() => setIsDragging(false)}
    >
      <div className="ticket-header">
        <span className="ticket-time-mono">
          {/* Wrapped so it can be told not to shrink. As a bare text node it
              became an anonymous flex item, which flexbox is free to squeeze —
              and "Stop #1" losing characters to make room for a reference
              number is the wrong way round. */}
          <span className="ticket-stop-label">
          {isTransfer ? (
            <><Repeat size={11} style={{ marginRight: 2 }} />{soVal ? 'Transfer#' : 'Transfer'}</>
          ) : isWillCall ? (
            <><PackageCheck size={11} style={{ marginRight: 2 }} /> Will Call</>
          ) : isReturnTicket && isCounterReturn(delivery) ? (
            // A drop-off is on nobody's route, so it has no stop number to
            // claim — same reason a will call says what it is instead. A
            // return a driver IS collecting, or one that's simply still
            // Pending with no driver picked yet, falls through to the
            // ordinary "Stop #N" below — the latter is exactly how a pending
            // jobsite renders too. What kind of stop it is gets said under
            // the address instead.
            <><Undo2 size={11} style={{ marginRight: 2 }} /> Drop-Off</>
          ) : (
            <><Navigation size={11} style={{ marginRight: 2 }} /> Stop #{stopNum}</>
          )}
          </span>
          {soVal && (
            // A divider of its own rather than a character inside the label
            // below: sitting inside the copy chip, it would light up with the
            // hover background and read as part of the number you are about to
            // copy. aria-hidden because it is punctuation between two things a
            // screen reader already announces separately.
            <span className="ticket-header-sep" aria-hidden="true">|</span>
          )}
          {soVal && (
            <span
              className={`so-header-inline-text ${copied ? 'copied' : ''}`}
              onClick={(e) => handleCopySO(e, soVal)}
              title={copied
                ? 'Copied to clipboard!'
                : `Click to copy ${isTransfer ? 'Transfer#' : 'SO#'} ${soVal}`}
            >
              {refLabel}
              <span className="so-num-highlight">{soVal}</span>
              {copied ? (
                <Check size={13} className="so-copy-icon success" />
              ) : (
                <Copy size={13} className="so-copy-icon" />
              )}
            </span>
          )}
        </span>
        <StatusPill status={delivery.status} size="small" />
      </div>

      <h5 className="ticket-customer">
        <Highlight text={delivery.customerName} query={searchQuery} />
      </h5>

      {/* A will call has no delivery address — the useful line is which vehicle
          is coming for it, which is what the counter needs on the day. */}
      {isWillCall ? (
        delivery.pickupInfo && (
          <p className="ticket-address">
            <Truck size={12} />
            <Highlight text={delivery.pickupInfo} query={searchQuery} />
          </p>
        )
      ) : delivery.address && (
        <p className="ticket-address">
          <MapPin size={12} />
          <Highlight text={delivery.address} query={searchQuery} />
        </p>
      )}

      {/* The one number a driver or the counter actually needs before touching
          anything — today it only lived inside the edit modal, so seeing it
          meant opening every card on the run just to find out how much to load.
          One conditional placement covers every card shape: it falls right
          after whatever the line above it was, so it reads as "next line under
          the address" on a jobsite or return, "next line under the pickup
          vehicle" on a will call, and — since a transfer shows neither of those
          today — as the first line under the customer name there, which is the
          same "next line" placement asked for.
          0 is treated the same way the modal already treats it (see the No. of
          Slabs field's own comment there): a ticket nobody has counted yet, not
          a delivery of zero slabs, so it stays silent rather than claiming a
          fact nobody has confirmed. */}
      {Number(delivery.numberOfSlabs) > 0 && (
        <p className="ticket-slabs">
          <Layers size={12} />
          {delivery.numberOfSlabs} {Number(delivery.numberOfSlabs) === 1 ? 'slab' : 'slabs'}
        </p>
      )}

      {/* Under the address rather than in the header, so every card's top line
          reads the same way. It still has to be impossible to miss — a driver
          loading a truck for a stop they were meant to collect from is the
          mistake this exists to prevent — which is what the red here and the
          red edge on the card are carrying now that the header is neutral. */}
      {isReturnTicket && (
        <p className="ticket-return-flag">
          <Undo2 size={12} />
          Return pickup
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
        {/* Last, so the footer's space-between reads rep · notes · sign. */}
        {canSign && (
          <button
            type="button"
            className={`ticket-sign-btn${wasCleared ? ' is-cleared' : ''}`}
            onClick={(e) => { e.stopPropagation(); onOpenPod(delivery); }}
            title={wasCleared
              ? 'The previous signature was cleared — capture a new one'
              : 'Capture the signature of whoever is collecting this order'}
          >
            <PenLine size={11} /> Sign ePOD
          </button>
        )}
      </div>
      )}
    </div>
  );
};

export default TicketChip;
