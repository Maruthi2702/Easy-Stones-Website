import React, { useState, useEffect } from 'react';
import { X, ShieldCheck, FileText, Calendar, Clock, User, Download, Camera, Layers } from 'lucide-react';
import { stampSignaturesOnPdf } from '../../../utils/pdfSigner';

/**
 * Read-only ePOD Viewer — shows the signed Proof of Delivery record.
 * Automatically stamps signatures onto the packing list PDF on-the-fly if needed.
 */
const PodViewer = ({ isOpen, onClose, delivery, trucks = [], currentUser = null }) => {
  const pod = delivery?.pod || {};
  const hasCustomerSig = Boolean(pod.customerSignature);
  const hasDriverSig = Boolean(pod.driverSignature);
  const signedDate = pod.signedAt ? new Date(pod.signedAt) : null;

  const [stampedUrl, setStampedUrl] = useState(pod.signedPdfUrl || null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  const getDriverName = () => (
    (delivery?.pod?.driverName && delivery.pod.driverName !== 'Driver' ? delivery.pod.driverName : '') ||
    currentUser?.name ||
    currentUser?.username ||
    delivery?.driverName ||
    delivery?.truckDriver ||
    delivery?.driver ||
    'Driver'
  );

  const resolvedDriver = getDriverName();

  useEffect(() => {
    if (isOpen && delivery) {
      const isGenericDriver = !delivery.pod?.driverName || delivery.pod?.driverName === 'Driver';
      
      if (delivery.packingListUrl && Boolean(delivery.pod?.customerSignature) && (!delivery.pod?.signedPdfUrl || isGenericDriver)) {
        setIsGeneratingPdf(true);
        const deliveryInfo = [
          delivery.soNumber ? `SO# ${delivery.soNumber}` : '',
          delivery.customerName || '',
          delivery.date || ''
        ].filter(Boolean).join(' - ');

        const drvName = getDriverName();

        stampSignaturesOnPdf({
          pdfUrl: delivery.packingListUrl,
          customerSignatureDataUrl: delivery.pod.customerSignature,
          driverSignatureDataUrl: delivery.pod.driverSignature,
          signeeName: delivery.pod.signeeName || '',
          driverName: drvName,
          deliveryInfo,
          signedAt: delivery.pod.signedAt || new Date()
        }).then(blob => {
          const url = URL.createObjectURL(blob);
          setStampedUrl(url);
        }).catch(err => {
          console.warn('[PodViewer] On-the-fly stamp error:', err);
          setStampedUrl(delivery.pod?.signedPdfUrl || null);
        }).finally(() => {
          setIsGeneratingPdf(false);
        });
      } else {
        setStampedUrl(delivery.pod?.signedPdfUrl || null);
      }
    }
  }, [isOpen, delivery]);

  if (!isOpen || !delivery) return null;

  const formatSignedDate = (d) => {
    if (!d || isNaN(d)) return '—';
    return d.toLocaleDateString('en-US', {
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
    });
  };

  const formatSignedTime = (d) => {
    if (!d || isNaN(d)) return '';
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  const isCompleted = delivery.status === 'completed';
  const effectiveSignedUrl = stampedUrl || pod.signedPdfUrl;

  return (
    <div className="pod-modal-overlay" onClick={onClose}>
      <div className="pod-modal-content pod-viewer-mode" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="pod-modal-header">
          <div className="pod-title-block">
            <h3>
              <ShieldCheck size={20} className="pod-icon" />
              {isCompleted ? 'ePOD — Signed & Completed' : 'Proof of Delivery'}
            </h3>
            <span className="pod-subtitle">
              {delivery.soNumber ? `SO# ${delivery.soNumber} · ` : ''}{delivery.customerName}
              {delivery.date ? ` · ${delivery.date}` : ''}
            </span>
          </div>
          <button type="button" className="pod-close-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="pod-modal-body">

          {/* Signed PDF Banner */}
          {isGeneratingPdf ? (
            <div className="pod-section packing-list-banner" style={{ borderColor: 'rgba(212, 175, 55, 0.4)', background: 'rgba(212, 175, 55, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.6rem 0.85rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FileText size={16} style={{ color: '#d4af37', flexShrink: 0 }} />
                <div className="banner-text">
                  <strong style={{ color: '#d4af37', fontSize: '0.82rem' }}>Generating Signed Packing List...</strong>
                </div>
              </div>
            </div>
          ) : effectiveSignedUrl ? (
            <div className="pod-section packing-list-banner" style={{ borderColor: 'rgba(52, 211, 153, 0.4)', background: 'rgba(52, 211, 153, 0.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.6rem 0.85rem', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                <FileText size={16} style={{ color: '#34d399', flexShrink: 0 }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <span style={{ color: '#34d399', fontWeight: 700, fontSize: '0.82rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    ✓ Signed Packing List (Embedded)
                  </span>
                  {delivery.packingListUrl && (
                    <a href={delivery.packingListUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#d4af37', textDecoration: 'underline', fontSize: '0.7rem' }}>
                      Original PDF
                    </a>
                  )}
                </div>
              </div>
              <a
                href={effectiveSignedUrl}
                target="_blank"
                rel="noopener noreferrer"
                download={pod.signedPdfFilename || `signed_packing_list_${delivery.soNumber || delivery.id}.pdf`}
                className="pod-view-pdf-btn"
                style={{ background: 'linear-gradient(135deg, #34d399, #10b981)', color: '#000', flexShrink: 0, padding: '0.35rem 0.75rem', fontSize: '0.78rem', fontWeight: 700 }}
              >
                <Download size={13} /> Open Signed PDF
              </a>
            </div>
          ) : delivery.packingListUrl ? (
            <div className="pod-section packing-list-banner" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.6rem 0.85rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FileText size={16} style={{ color: '#d4af37', flexShrink: 0 }} />
                <span style={{ color: '#d4af37', fontWeight: 700, fontSize: '0.82rem' }}>Attached Packing List</span>
              </div>
              <a
                href={delivery.packingListUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="pod-view-pdf-btn"
                style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem' }}
              >
                <Download size={13} /> Open Original PDF
              </a>
            </div>
          ) : null}

          {/* Signed By + Date */}
          <div className="pod-section pod-info-row">
            <div className="pod-info-cell">
              <div className="pod-info-label"><User size={13} /> Customer Signee</div>
              <div className="pod-info-value">{pod.signeeName || '—'}</div>
            </div>
            <div className="pod-info-cell">
              <div className="pod-info-label"><Calendar size={13} /> Signed Date</div>
              <div className="pod-info-value">{formatSignedDate(signedDate)}</div>
            </div>
            <div className="pod-info-cell">
              <div className="pod-info-label"><Clock size={13} /> Time</div>
              <div className="pod-info-value">{formatSignedTime(signedDate) || '—'}</div>
            </div>
          </div>

          {/* Signature Images */}
          <div className="pod-signature-grid">
            {/* Customer Signature */}
            <div className="pod-sig-box">
              <div className="sig-box-header">
                <label className="pod-label">Customer Signature</label>
                {hasCustomerSig && (
                  <span className="sig-verified-badge">✓ Signed</span>
                )}
              </div>
              {hasCustomerSig ? (
                <div className="pod-sig-img-wrap">
                  <img
                    src={pod.customerSignature}
                    alt="Customer signature"
                    className="pod-sig-img"
                  />
                </div>
              ) : (
                <div className="pod-sig-empty">No customer signature on record</div>
              )}
              {pod.signeeName && (
                <span className="sig-hint">Signed by: {pod.signeeName}</span>
              )}
            </div>

            {/* Driver Signature */}
            <div className="pod-sig-box">
              <div className="sig-box-header">
                <label className="pod-label">Driver Signature</label>
                {hasDriverSig && (
                  <span className="sig-verified-badge">✓ Signed</span>
                )}
              </div>
              {hasDriverSig ? (
                <div className="pod-sig-img-wrap">
                  <img
                    src={pod.driverSignature}
                    alt="Driver signature"
                    className="pod-sig-img"
                  />
                </div>
              ) : (
                <div className="pod-sig-empty">No driver signature on record</div>
              )}
              <span className="sig-hint">Driver: {resolvedDriver}</span>
            </div>
          </div>

          {/* Delivery Photos */}
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

          {/* Notes */}
          {pod.notes && (
            <div className="pod-section">
              <label className="pod-label">Completion Notes</label>
              <div className="pod-notes-readonly">{pod.notes}</div>
            </div>
          )}

          {/* No ePOD message */}
          {!hasCustomerSig && !pod.signeeName && !delivery.packingListUrl && (
            <div className="pod-empty-state">
              <ShieldCheck size={40} style={{ opacity: 0.3, color: '#d4af37' }} />
              <p>No ePOD has been signed for this delivery yet.</p>
              <span>The driver needs to complete the Delivered / Sign ePOD step.</span>
            </div>
          )}
        </div>

        <div className="pod-modal-footer">
          <button type="button" className="pod-btn-cancel" onClick={onClose}>Close</button>
          {(effectiveSignedUrl || delivery.packingListUrl) && (
            <a
              href={effectiveSignedUrl || delivery.packingListUrl}
              target="_blank"
              rel="noopener noreferrer"
              download={pod.signedPdfFilename || delivery.packingListFilename || 'signed_packing_list.pdf'}
              className="pod-btn-submit"
              style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, background: effectiveSignedUrl ? 'linear-gradient(135deg, #34d399, #10b981)' : undefined, color: effectiveSignedUrl ? '#000' : undefined }}
            >
              <Download size={16} /> {effectiveSignedUrl ? 'Open Signed PDF' : 'Download Packing List'}
            </a>
          )}
        </div>
      </div>
    </div>
  );
};

export default PodViewer;
