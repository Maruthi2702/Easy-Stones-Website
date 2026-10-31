import { MapPin, CheckCircle2, AlertTriangle, FileText, Navigation, Copy, Check, User, Repeat, Clock, ShieldCheck, RotateCcw, Undo2, Phone } from 'lucide-react';
import { openPdfInline } from '../../../utils/packingList';
import StatusPill from '../board/StatusPill';
import { cleanField, mapsHrefFor } from './driverFormat';
import type { Ticket } from '../types';

export type DriverStopProps = {
  del: Ticket;
  /** The stop whose reference was just copied, and the one with a status change in flight. */
  copiedId: string | null;
  busyId: string | null;
  onCopy: (id: string, value: string) => void;
  onStatus: (del: Ticket, nextStatus: string) => void;
  onOpenPod?: (delivery: Ticket) => void;
  onViewPod?: (delivery: Ticket) => void;
};

/** One stop on the driver's run: where, when, what, and its buttons. */
export default function DriverStop({ del, copiedId, busyId, onCopy, onStatus, onOpenPod, onViewPod }: DriverStopProps) {
  // The saved stop number, the same one the board and the office's
  // form show: the server keeps each run numbered 1, 2, 3 (see
  // renumberRuns in src/routes/deliveries.ts), and two invoices
  // sharing a number are one stop.
  const stopNum = Number(del.routeNumber) || 1;
  const soVal = cleanField(del.soNumber) || cleanField(del.invoiceNumber);
  const isTransfer = del.deliveryType === 'transfer';
  const address = cleanField(del.address) || cleanField(del.city);
  const mapsHref = mapsHrefFor(address);
  const phone = cleanField(del.phone) || cleanField(del.customerPhone) || cleanField(del.contactPhone);
  const time = cleanField(del.time);
  const notes = cleanField(del.notes);
  const isDone = del.status === 'completed';
  const isLate = del.status === 'delayed';
  const isBusy = busyId === del.id;
  const hasProof = Boolean(del.pod?.verified);
  const awaitingResign = Boolean(del.pod?.clearedAt) && !hasProof;

  return (
    <li className={`dv-stop is-${del.status || 'scheduled'}`}>
      <div className="dv-stop-top">
        <span className="dv-stop-badge">
          {isTransfer
            ? <><Repeat size={12} aria-hidden="true" /> Transfer</>
            : <><Navigation size={12} aria-hidden="true" /> Stop {stopNum}</>}
        </span>
        <StatusPill status={del.status} size="small" />
      </div>

      <h3 className="dv-stop-customer">
        {isTransfer && cleanField(del.transferDestination)
          ? `Transfer → ${cleanField(del.transferDestination)}`
          : cleanField(del.customerName) || 'Unnamed stop'}
      </h3>

      <dl className="dv-stop-meta">
        {address && (
          <div className="dv-meta-row">
            <dt><MapPin size={14} aria-hidden="true" /><span className="dv-sr">Address</span></dt>
            <dd>{address}</dd>
          </div>
        )}
        {time && (
          <div className="dv-meta-row">
            <dt><Clock size={14} aria-hidden="true" /><span className="dv-sr">Time</span></dt>
            <dd>{time}</dd>
          </div>
        )}
        {soVal && (
          <div className="dv-meta-row">
            <dt><FileText size={14} aria-hidden="true" /><span className="dv-sr">Reference</span></dt>
            <dd>
              <button
                type="button"
                className={`dv-copy ${copiedId === del.id ? 'is-copied' : ''}`}
                onClick={() => onCopy(del.id, soVal)}
                title={copiedId === del.id ? 'Copied' : `Copy ${isTransfer ? 'transfer number' : 'SO number'}`}
              >
                {isTransfer ? 'Transfer' : 'SO'} #{soVal}
                {copiedId === del.id ? <Check size={12} /> : <Copy size={12} />}
              </button>
            </dd>
          </div>
        )}
        {!isTransfer && cleanField(del.salesRepName) && (
          <div className="dv-meta-row">
            <dt><User size={14} aria-hidden="true" /><span className="dv-sr">Sales rep</span></dt>
            <dd>{cleanField(del.salesRepName)}</dd>
          </div>
        )}
      </dl>

      {/* The office writes these for the driver and nothing was
          showing them — gate codes, who to ask for, where to back in. */}
      {notes && (
        <p className="dv-stop-notes">
          <FileText size={13} aria-hidden="true" />
          <span>{notes}</span>
        </p>
      )}

      {(hasProof || awaitingResign) && (
        <p className={`dv-proof ${awaitingResign ? 'is-pending' : ''}`}>
          {awaitingResign
            ? <><RotateCcw size={12} aria-hidden="true" /> Signature was cleared — needs re-signing</>
            : <><ShieldCheck size={12} aria-hidden="true" /> Signed ePOD on file</>}
        </p>
      )}

      <div className="dv-stop-actions">
        {mapsHref && (
          <a
            className="dv-btn dv-btn-nav"
            href={mapsHref}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Navigation size={15} aria-hidden="true" /> Navigate
          </a>
        )}

        {phone && (
          <a className="dv-btn dv-btn-call" href={`tel:${phone.replace(/[^\d+]/g, '')}`}>
            <Phone size={15} aria-hidden="true" /> Call
          </a>
        )}

        {del.packingListUrl && (
          <button
            type="button"
            className="dv-btn dv-btn-doc"
            onClick={() => openPdfInline(del.packingListUrl)}
          >
            <FileText size={15} aria-hidden="true" /> Packing list
          </button>
        )}

        {/* Toggles. A stop wrongly marked late had no way back, so
            the board kept showing a delay that had been cleared. */}
        {!isDone && (
          <button
            type="button"
            className={`dv-btn dv-btn-late ${isLate ? 'is-on' : ''}`}
            onClick={() => onStatus(del, isLate ? 'scheduled' : 'delayed')}
            disabled={isBusy}
          >
            {isLate
              ? <><Undo2 size={15} aria-hidden="true" /> Back on time</>
              : <><AlertTriangle size={15} aria-hidden="true" /> Running late</>}
          </button>
        )}

        <button
          type="button"
          className={`dv-btn dv-btn-deliver ${isDone ? 'is-done' : ''}`}
          onClick={() => {
            if (isDone && onViewPod) onViewPod(del);
            else if (onOpenPod) onOpenPod(del);
          }}
          disabled={isBusy}
        >
          <CheckCircle2 size={15} aria-hidden="true" />
          {isDone ? 'View ePOD' : 'Delivered / Sign ePOD'}
        </button>
      </div>
    </li>
  );
}
