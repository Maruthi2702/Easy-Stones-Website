import React, { useState, useEffect } from 'react';
import { X, ShieldCheck, FileText, Calendar, User, Download, Camera, Link2, Check, RotateCcw, AlertTriangle } from 'lucide-react';
import { packingListFileName, signedPackingListFileName, downloadPdf } from '../../../utils/packingList';

/**
 * Read-only ePOD viewer — shows the signed Proof of Delivery record.
 *
 * pod.signedPdfUrl is the single source of truth. This used to re-stamp the PDF
 * on every open into a blob: URL, which existed only in the tab that made it —
 * so no two users ever saw the same document, and a record whose driver name
 * was generic got a second certificate stamped over the first.
 */
const PodViewer = ({
  isOpen,
  onClose,
  delivery,
  currentUser = null,
  canClearPod = false,
  onClearPod
}) => {
  const pod = delivery?.pod || {};
  const hasCustomerSig = Boolean(pod.customerSignature);
  const hasDriverSig = Boolean(pod.driverSignature);

  const [copied, setCopied] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [showClearForm, setShowClearForm] = useState(false);
  const [clearReason, setClearReason] = useState('');
  const [clearError, setClearError] = useState(null);

  useEffect(() => {
    if (isOpen) {
      setShowClearForm(false);
      setClearReason('');
      setClearError(null);
      setCopied(false);
    }
  }, [isOpen, delivery?.id]);

  if (!isOpen || !delivery) return null;

  const resolvedDriver = (
    (pod.driverName && pod.driverName !== 'Driver' ? pod.driverName : '') ||
    delivery.driverName ||
    delivery.truckDriver ||
    delivery.driver ||
    currentUser?.name ||
    'Driver'
  );

  const formatStamp = (value) => {
    if (!value) return '—';
    const d = new Date(value);
    if (isNaN(d)) return '—';
    return `${d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
  };

  const signedUrl = pod.signedPdfUrl || '';
  const isVerified = Boolean(pod.verified);
  const wasCleared = Boolean(pod.clearedAt) && !isVerified;

  // Derived rather than read from pod.signedPdfFilename, so records signed
  // before this naming existed still download as 145994_signed.pdf.
  const downloadName = signedPackingListFileName(delivery);
  const originalName = packingListFileName(delivery);

  const handleCopyLink = () => {
    if (!signedUrl) return;
    try {
      navigator.clipboard.writeText(signedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (err) {
      console.warn('[PodViewer] clipboard copy failed:', err);
    }
  };

  const handleConfirmClear = async () => {
    if (clearReason.trim().length < 4) {
      setClearError('Please describe why this signature is being cleared.');
      return;
    }
    setIsClearing(true);
    setClearError(null);
    try {
      await onClearPod(delivery, clearReason.trim());
      setShowClearForm(false);
      setClearReason('');
    } catch (err) {
      setClearError(err?.message || 'Could not clear the ePOD. Please try again.');
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <div className="pod-modal-overlay" onClick={onClose}>
      <div className="pod-modal-content pod-viewer-mode" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="pod-modal-header">
          <div className="pod-title-block">
            <h3>
              <ShieldCheck size={20} className="pod-icon" />
              {isVerified ? 'ePOD — Signed & Completed' : 'Proof of Delivery'}
            </h3>
            <span className="pod-subtitle">
              {delivery.soNumber ? `SO# ${delivery.soNumber} · ` : ''}{delivery.customerName}
              {delivery.date ? ` · ${delivery.date}` : ''}
            </span>
          </div>
          <button type="button" className="pod-close-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="pod-modal-body">

          {/* Signed document — the thing people actually came for */}
          {isVerified && signedUrl && (
            <div className="pod-signed-strip">
              <FileText size={18} className="pod-signed-icon" />
              <div className="pod-signed-meta">
                <span className="pod-signed-name">{downloadName}</span>
                {delivery.packingListUrl && (
                  <button
                    type="button"
                    className="pod-original-link"
                    onClick={() => downloadPdf(delivery.packingListUrl, originalName)}
                  >
                    Original packing list ({originalName})
                  </button>
                )}
              </div>
              <div className="pod-signed-actions">
                <a href={signedUrl} target="_blank" rel="noopener noreferrer" className="pod-doc-btn primary">
                  View
                </a>
                <button
                  type="button"
                  className="pod-doc-btn"
                  onClick={() => downloadPdf(signedUrl, downloadName)}
                >
                  <Download size={13} /> Download
                </button>
                <button type="button" className="pod-doc-btn" onClick={handleCopyLink}>
                  {copied ? <><Check size={13} /> Copied</> : <><Link2 size={13} /> Copy link</>}
                </button>
              </div>
            </div>
          )}

          {/* Cleared — awaiting a fresh signature */}
          {wasCleared && (
            <div className="pod-cleared-strip">
              <RotateCcw size={17} className="pod-cleared-icon" />
              <div className="pod-cleared-body">
                <strong>Signature cleared — awaiting re-sign</strong>
                <span>
                  Cleared by {pod.clearedBy || 'a user'} on {formatStamp(pod.clearedAt)}
                </span>
                {pod.clearReason && <span className="pod-cleared-reason">“{pod.clearReason}”</span>}
              </div>
            </div>
          )}

          {/* Unsigned but a packing list exists */}
          {!isVerified && !wasCleared && delivery.packingListUrl && (
            <div className="pod-section packing-list-banner">
              <FileText size={16} style={{ color: '#d4af37', flexShrink: 0 }} />
              <div className="banner-text">
                <strong>Packing list attached</strong>
                <span>No signature captured yet</span>
              </div>
              <a
                href={delivery.packingListUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="pod-view-pdf-btn"
              >
                <Download size={13} /> Open PDF
              </a>
            </div>
          )}

          {/* Signee + both timestamps */}
          {(hasCustomerSig || pod.signeeName) && (
            <div className="pod-section pod-info-row">
              <div className="pod-info-cell">
                <div className="pod-info-label"><User size={13} /> Customer Signee</div>
                <div className="pod-info-value">{pod.signeeName || '—'}</div>
              </div>
              <div className="pod-info-cell">
                <div className="pod-info-label"><Calendar size={13} /> Customer Signed</div>
                <div className="pod-info-value">{formatStamp(pod.customerSignedAt || pod.signedAt)}</div>
              </div>
              <div className="pod-info-cell">
                <div className="pod-info-label"><Calendar size={13} /> Driver Signed</div>
                <div className="pod-info-value">{formatStamp(pod.driverSignedAt || pod.signedAt)}</div>
              </div>
            </div>
          )}

          {/* Signature images */}
          {(hasCustomerSig || hasDriverSig) && (
            <div className="pod-signature-grid">
              <div className="pod-sig-box">
                <div className="sig-box-header">
                  <label className="pod-label">Customer Signature</label>
                  {hasCustomerSig && <span className="sig-verified-badge">✓ Signed</span>}
                </div>
                {hasCustomerSig ? (
                  <div className="pod-sig-img-wrap">
                    <img src={pod.customerSignature} alt="Customer signature" className="pod-sig-img" />
                  </div>
                ) : (
                  <div className="pod-sig-empty">No customer signature on record</div>
                )}
                {pod.signeeName && <span className="sig-hint">Signed by: {pod.signeeName}</span>}
              </div>

              <div className="pod-sig-box">
                <div className="sig-box-header">
                  <label className="pod-label">Driver Signature</label>
                  {hasDriverSig && <span className="sig-verified-badge">✓ Signed</span>}
                </div>
                {hasDriverSig ? (
                  <div className="pod-sig-img-wrap">
                    <img src={pod.driverSignature} alt="Driver signature" className="pod-sig-img" />
                  </div>
                ) : (
                  <div className="pod-sig-empty">No driver signature on record</div>
                )}
                <span className="sig-hint">Driver: {resolvedDriver}</span>
              </div>
            </div>
          )}

          {/* Delivery photos */}
          {pod.photos && pod.photos.length > 0 && (
            <div className="pod-section">
              <label className="pod-label">
                <Camera size={14} /> Delivered Slab Photos ({pod.photos.length})
              </label>
              <div className="pod-photos-preview-grid">
                {pod.photos.map((src, idx) => (
                  <div key={idx} className="pod-photo-thumb">
                    <img src={src} alt={`Delivery photo ${idx + 1}`} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {pod.notes && (
            <div className="pod-section">
              <label className="pod-label">Completion Notes</label>
              <div className="pod-notes-readonly">{pod.notes}</div>
            </div>
          )}

          {!hasCustomerSig && !pod.signeeName && !delivery.packingListUrl && !wasCleared && (
            <div className="pod-empty-state">
              <ShieldCheck size={40} style={{ opacity: 0.3, color: '#d4af37' }} />
              <p>No ePOD has been signed for this delivery yet.</p>
              <span>The driver needs to complete the Delivered / Sign ePOD step.</span>
            </div>
          )}

          {/* Clear signatures — hidden entirely without the permission, rather
              than shown disabled, so nobody is offered a control they can't use. */}
          {canClearPod && isVerified && (
            <div className="pod-danger-zone">
              <div className="pod-dz-text">
                <strong>Clear signatures</strong>
                <span>Removes the signed copy so the customer can sign again. The original packing list is kept.</span>
              </div>
              <button type="button" className="pod-btn-danger" onClick={() => setShowClearForm(true)}>
                Clear signatures
              </button>
            </div>
          )}
        </div>

        <div className="pod-modal-footer">
          <button type="button" className="pod-btn-cancel" onClick={onClose}>Close</button>
          {(signedUrl || delivery.packingListUrl) && (
            <button
              type="button"
              onClick={() => (signedUrl
                ? downloadPdf(signedUrl, downloadName)
                : downloadPdf(delivery.packingListUrl, originalName))}
              className="pod-btn-submit"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: signedUrl ? 'linear-gradient(135deg, #34d399, #10b981)' : undefined,
                color: signedUrl ? '#000' : undefined
              }}
            >
              <Download size={16} /> {signedUrl ? `Download ${downloadName}` : `Download ${originalName}`}
            </button>
          )}
        </div>

        {/* Clearing an ePOD is destructive and irreversible, so it asks in a
            pop-up over the record rather than in a panel that can sit below the
            fold of a scrolled modal. */}
        {showClearForm && (
          <div
            className="pod-confirm-backdrop"
            onClick={() => { if (!isClearing) { setShowClearForm(false); setClearError(null); } }}
          >
            <div className="pod-confirm-card" onClick={(e) => e.stopPropagation()}>
              <div className="pod-confirm-badge">
                <AlertTriangle size={22} />
              </div>
              <h4 className="pod-confirm-title">
                Clear the ePOD for {delivery.soNumber ? `SO# ${delivery.soNumber}` : delivery.customerName}?
              </h4>
              <p className="pod-confirm-copy">
                This permanently deletes the signed PDF, both signature images, the signee name
                and both timestamps. The delivery stays completed and the original packing list
                is untouched.
              </p>

              <label className="pod-label pod-confirm-label" htmlFor="pod-clear-reason">
                Reason <span className="req-star">*</span>
              </label>
              {/* no-capitalize: index.css title-cases every text input, and a
                  free-text reason should read as typed rather than as
                  "Signed By The Wrong Customer At A Shared Jobsite". */}
              <input
                id="pod-clear-reason"
                type="text"
                className="pod-input-field no-capitalize"
                value={clearReason}
                onChange={(e) => setClearReason(e.target.value)}
                placeholder="e.g. signed by the wrong customer at a shared jobsite"
                autoComplete="off"
                autoFocus
                disabled={isClearing}
              />
              <span className="sig-hint">Recorded in the activity log against your name.</span>

              {clearError && <div className="pod-error-alert">{clearError}</div>}

              <div className="pod-confirm-actions">
                <button
                  type="button"
                  className="pod-btn-cancel"
                  onClick={() => { setShowClearForm(false); setClearError(null); }}
                  disabled={isClearing}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="pod-btn-danger pod-confirm-go"
                  onClick={handleConfirmClear}
                  disabled={isClearing || clearReason.trim().length < 4}
                >
                  {isClearing ? 'Clearing…' : 'Clear signatures'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PodViewer;
