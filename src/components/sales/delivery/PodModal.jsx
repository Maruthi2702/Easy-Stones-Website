import React, { useState, useRef, useEffect } from 'react';
import { X, Check, Camera, Upload, FileText, ShieldCheck, Eye, Layers } from 'lucide-react';
import { formatTitleCase } from '../../../utils/textUtils';
import { packingListFileName, openPdfInline } from '../../../utils/packingList';
import { isPickupDelivery, wordingFor } from '../../../utils/deliveryPickup';
import './PodModal.css';

/**
 * Proof of Delivery (ePOD) Modal component
 * Captures Customer Signee Name, Touchscreen Customer Signature, Driver Signature,
 * and 1-4 Delivered Slab Photos.
 *
 * A pickup captures the same two marks, but they are not the same two people:
 * the customer or carrier collecting signs where a customer would, and the
 * staff member handing the material over signs where the driver would. Only the
 * wording changes — every rule about what makes an ePOD valid is unchanged.
 */
const PodModal = ({ isOpen, onClose, delivery, trucks = [], currentUser = null, onSavePod }) => {
  const isPickup = isPickupDelivery(delivery, trucks);
  const words = wordingFor(isPickup);

  const [signeeName, setSigneeName] = useState(delivery?.pod?.signeeName || '');
  const [podNotes, setPodNotes] = useState(delivery?.pod?.notes || '');
  const [photos, setPhotos] = useState(delivery?.pod?.photos || []);
  const [, setUploadingPhoto] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isStampingPdf, setIsStampingPdf] = useState(false);
  const [error, setError] = useState(null);

  // Canvas references for drawing signatures
  const custCanvasRef = useRef(null);
  const driverCanvasRef = useRef(null);

  const [isCustDrawing, setIsCustDrawing] = useState(false);
  const [isDriverDrawing, setIsDriverDrawing] = useState(false);

  const [hasCustSignature, setHasCustSignature] = useState(Boolean(delivery?.pod?.customerSignature));
  const [hasDriverSignature, setHasDriverSignature] = useState(Boolean(delivery?.pod?.driverSignature));

  // Each pad records its own time when the pen lifts. Stamping both at submit
  // would make the two dates identical and meaningless.
  const [custSignedAt, setCustSignedAt] = useState(delivery?.pod?.customerSignedAt || null);
  const [driverSignedAt, setDriverSignedAt] = useState(delivery?.pod?.driverSignedAt || null);

  // Initialize canvas drawings if existing signature exists
  useEffect(() => {
    if (isOpen) {
      setSigneeName(delivery?.pod?.signeeName || '');
      setPodNotes(delivery?.pod?.notes || '');
      setPhotos(delivery?.pod?.photos || []);
      setHasCustSignature(Boolean(delivery?.pod?.customerSignature));
      setHasDriverSignature(Boolean(delivery?.pod?.driverSignature));
      setCustSignedAt(delivery?.pod?.customerSignedAt || null);
      setDriverSignedAt(delivery?.pod?.driverSignedAt || null);
      setError(null);

      setTimeout(() => {
        initCanvas(custCanvasRef, delivery?.pod?.customerSignature);
        initCanvas(driverCanvasRef, delivery?.pod?.driverSignature);
      }, 100);
    }
  }, [isOpen, delivery]);

  // Rotating a phone changes the pad's width, which would leave the backing
  // store mismatched all over again. Re-fit any pad that hasn't been signed;
  // one that has is left alone rather than wiping a captured signature.
  useEffect(() => {
    if (!isOpen) return undefined;
    const refit = () => {
      if (!hasCustSignature) initCanvas(custCanvasRef, null);
      if (!hasDriverSignature) initCanvas(driverCanvasRef, null);
    };
    window.addEventListener('resize', refit);
    window.addEventListener('orientationchange', refit);
    return () => {
      window.removeEventListener('resize', refit);
      window.removeEventListener('orientationchange', refit);
    };
  }, [isOpen, hasCustSignature, hasDriverSignature]);

  const formatStamp = (value) => {
    if (!value) return null;
    const d = new Date(value);
    if (isNaN(d)) return null;
    return `${d.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })} · ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  };

  const initCanvas = (ref, sigDataUrl) => {
    const canvas = ref.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;

    // The backing store has to match the box the browser actually gave us. It
    // was fixed at 340x130 while CSS stretched the element to 100% width, so
    // every stroke was written into a narrower coordinate space and then scaled
    // out — signatures landed off-position and came out horizontally smeared.
    // Multiplying by devicePixelRatio also stops them looking soft on a phone.
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (sigDataUrl) {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, rect.width, rect.height);
        // Fit a stored signature to the pad rather than drawing it 1:1, since
        // it may have been captured on a differently sized screen.
        const scale = Math.min(rect.width / img.width, rect.height / img.height, 1);
        ctx.drawImage(img, 0, 0, img.width * scale, img.height * scale);
      };
      img.src = sigDataUrl;
    }
  };

  // Generic Touch / Mouse Handlers for Canvas Drawing
  const startDrawing = (e, ref, setDrawing) => {
    setDrawing(true);
    draw(e, ref);
  };

  const stopDrawing = (setDrawing, ref, setHasSig, setSignedAt) => {
    setDrawing(false);
    const canvas = ref.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.beginPath();
      setHasSig(true);
      setSignedAt(new Date().toISOString());
    }
  };

  const draw = (e, ref) => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    let clientX = e.clientX;
    let clientY = e.clientY;

    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    }

    const x = clientX - rect.left;
    const y = clientY - rect.top;

    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const clearCanvas = (ref, setHasSig, setSignedAt) => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    // Clear in device pixels — the context carries a devicePixelRatio scale.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    ctx.beginPath();
    setHasSig(false);
    setSignedAt(null);
  };

  // Handle Photo Upload
  const handlePhotoUpload = (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    setUploadingPhoto(true);
    // Convert to base64 preview or upload
    files.forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPhotos(prev => [...prev, reader.result].slice(0, 6));
        setUploadingPhoto(false);
      };
      reader.readAsDataURL(file);
    });
  };

  const removePhoto = (idx) => {
    setPhotos(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    if (!signeeName.trim()) {
      setError(words.errorSignee);
      return;
    }
    if (!hasCustSignature) {
      setError(words.errorCustomerSig);
      return;
    }
    if (!hasDriverSignature) {
      setError(words.errorDriverSig);
      return;
    }

    setIsSaving(true);
    setIsStampingPdf(Boolean(delivery.packingListUrl));
    setError(null);

    const custSigDataUrl = custCanvasRef.current ? custCanvasRef.current.toDataURL() : '';
    const driverSigDataUrl = driverCanvasRef.current ? driverCanvasRef.current.toDataURL() : '';
    const signedAt = new Date();

    // On a pickup this is the staff member releasing the material, which is the
    // logged-in office user — never the truck's driver, who is not involved.
    const resolvedDriverName = (
      currentUser?.name ||
      currentUser?.username ||
      (delivery?.pod?.driverName && delivery.pod.driverName !== 'Driver' ? delivery.pod.driverName : '') ||
      delivery?.driverName ||
      delivery?.truckDriver ||
      delivery?.driver ||
      'Driver'
    );

    // Only the signature images travel — roughly 30KB. The server fetches the
    // packing list, stamps the certificate and stores the signed copy, so a
    // driver on cellular no longer downloads and re-uploads a multi-MB PDF, and
    // there is no half-finished state where the upload succeeded but the save
    // didn't.
    const podData = {
      signeeName: signeeName.trim(),
      driverName: resolvedDriverName,
      customerSignature: custSigDataUrl,
      driverSignature: driverSigDataUrl,
      customerSignedAt: custSignedAt || signedAt.toISOString(),
      driverSignedAt: driverSignedAt || signedAt.toISOString(),
      signedAt,
      photos,
      notes: podNotes
    };

    try {
      if (onSavePod) {
        await onSavePod(podData);
      }
      onClose();
    } catch (err) {
      // No local-blob fallback: a blob: URL is meaningless to every other user
      // and used to be written to the database as if it were a real document.
      setError(
        err?.message ||
        'Could not save the proof of delivery. Check your signal and try again — nothing has been recorded yet.'
      );
    } finally {
      setIsSaving(false);
      setIsStampingPdf(false);
    }
  };

  if (!isOpen || !delivery) return null;

  // Both signatures are mandatory — an ePOD with only one party's mark isn't
  // proof of anything, and the server will refuse to mark it verified anyway.
  const missingParts = [
    !signeeName.trim() && words.missingSignee,
    !hasCustSignature && words.missingCustomerSig,
    !hasDriverSignature && words.missingDriverSig
  ].filter(Boolean);
  const isReadyToSubmit = missingParts.length === 0;

  // One subtitle line, the way the delivery modal has always read. A pickup adds
  // what the counter checks the collector against — the carrier and its PRO
  // number on contract freight, the vehicle coming for a will call — as further
  // segments rather than a second line, which orphaned the vehicle under the
  // customer and made the header look like a wrapped sentence.
  //
  // Customer names arrive with trailing punctuation ("1st Ave Kitchen & Bath
  // INC.,"), which reads as a mistake once something follows it.
  const subtitle = [
    `${words.reference} #${delivery.soNumber || delivery.id}`,
    String(delivery.customerName || '').replace(/[\s,;·]+$/, ''),
    ...(isPickup ? [
      delivery.carrierName,
      delivery.proNumber && `PRO# ${delivery.proNumber}`,
      delivery.pickupInfo && `Vehicle ${delivery.pickupInfo}`
    ] : [])
  ].filter(Boolean).join(' • ');

  return (
    <div className="pod-modal-overlay">
      <div className="pod-modal-content">
        <div className="pod-modal-header">
          <div className="pod-title-block">
            <h3><ShieldCheck size={20} className="pod-icon" /> {words.title}</h3>
            <span className="pod-subtitle">{subtitle}</span>
          </div>
          <button type="button" className="pod-close-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="pod-modal-body">
          {error && <div className="pod-error-alert">{error}</div>}

          {/* Attached Packing List Section */}
          {delivery.packingListUrl && (
            <div className="pod-section packing-list-banner">
              <FileText size={18} style={{ color: '#d4af37' }} />
              <div className="banner-text">
                <strong>Attached Packing List Document:</strong>
                <span>{packingListFileName(delivery)}</span>
              </div>
              {/* Opens rather than downloads — the driver is reading it on a
                  phone. A link cannot do that here: the stored asset is served
                  as an attachment, so the bytes are re-wrapped as a PDF first.
                  The Download buttons in the viewer save it by name. */}
              <button
                type="button"
                className="pod-view-pdf-btn"
                onClick={() => openPdfInline(delivery.packingListUrl)}
              >
                <Eye size={14} /> Open PDF
              </button>
            </div>
          )}

          {/* Signee Customer Information */}
          <div className="pod-section">
            <label className="pod-label">{words.signeeLabel} <span className="req-star">*</span></label>
            <input
              type="text"
              value={signeeName}
              onChange={(e) => setSigneeName(formatTitleCase(e.target.value))}
              placeholder={words.signeePlaceholder}
              className="pod-input-field"
            />
          </div>

          {/* Signature Canvas Grid */}
          <div className="pod-signature-grid">
            {/* Customer Signature Pad */}
            <div className="pod-sig-box">
              <div className="sig-box-header">
                <label className="pod-label">{words.customerSigLabel} <span className="req-star">*</span></label>
                <button type="button" className="sig-clear-btn" onClick={() => clearCanvas(custCanvasRef, setHasCustSignature, setCustSignedAt)}>Clear</button>
              </div>
              <canvas
                ref={custCanvasRef}
                width={340}
                height={130}
                className={`sig-canvas ${hasCustSignature ? 'is-signed' : ''}`}
                onMouseDown={(e) => startDrawing(e, custCanvasRef, setIsCustDrawing)}
                onMouseMove={(e) => isCustDrawing && draw(e, custCanvasRef)}
                onMouseUp={() => stopDrawing(setIsCustDrawing, custCanvasRef, setHasCustSignature, setCustSignedAt)}
                onTouchStart={(e) => startDrawing(e, custCanvasRef, setIsCustDrawing)}
                onTouchMove={(e) => isCustDrawing && draw(e, custCanvasRef)}
                onTouchEnd={() => stopDrawing(setIsCustDrawing, custCanvasRef, setHasCustSignature, setCustSignedAt)}
              />
              {formatStamp(custSignedAt)
                ? <span className="sig-stamp"><Check size={11} /> Signed {formatStamp(custSignedAt)}</span>
                : <span className="sig-hint">{words.customerHint}</span>}
            </div>

            {/* Driver Signature Pad */}
            <div className="pod-sig-box">
              <div className="sig-box-header">
                <label className="pod-label">{words.driverSigLabel} <span className="req-star">*</span></label>
                <button type="button" className="sig-clear-btn" onClick={() => clearCanvas(driverCanvasRef, setHasDriverSignature, setDriverSignedAt)}>Clear</button>
              </div>
              <canvas
                ref={driverCanvasRef}
                width={340}
                height={130}
                className={`sig-canvas ${hasDriverSignature ? 'is-signed' : ''}`}
                onMouseDown={(e) => startDrawing(e, driverCanvasRef, setIsDriverDrawing)}
                onMouseMove={(e) => isDriverDrawing && draw(e, driverCanvasRef)}
                onMouseUp={() => stopDrawing(setIsDriverDrawing, driverCanvasRef, setHasDriverSignature, setDriverSignedAt)}
                onTouchStart={(e) => startDrawing(e, driverCanvasRef, setIsDriverDrawing)}
                onTouchMove={(e) => isDriverDrawing && draw(e, driverCanvasRef)}
                onTouchEnd={() => stopDrawing(setIsDriverDrawing, driverCanvasRef, setHasDriverSignature, setDriverSignedAt)}
              />
              {formatStamp(driverSignedAt)
                ? <span className="sig-stamp"><Check size={11} /> Signed {formatStamp(driverSignedAt)}</span>
                : <span className="sig-hint">{words.driverHint}</span>}
            </div>
          </div>

          {/* Photos Upload Section */}
          <div className="pod-section">
            <div className="sig-box-header" style={{ marginBottom: '0.45rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label className="pod-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, margin: 0 }}>
                <Camera size={15} /> {words.photosLabel}
              </label>
              <label className="pod-upload-btn">
                <Upload size={14} /> Add Photos
                <input type="file" accept="image/*" multiple onChange={handlePhotoUpload} style={{ display: 'none' }} />
              </label>
            </div>
            <div className="pod-photos-preview-grid">
              {photos.map((src, pIdx) => (
                <div key={pIdx} className="pod-photo-thumb">
                  <img src={src} alt={`POD Slab Inspection ${pIdx + 1}`} />
                  <button type="button" className="photo-remove-btn" onClick={() => removePhoto(pIdx)}><X size={12} /></button>
                </div>
              ))}
              {photos.length === 0 && (
                <div className="pod-photos-empty">
                  <span>No slab photos attached yet. Tap "Add Photos" to capture delivery condition.</span>
                </div>
              )}
            </div>
          </div>

          {/* Delivery Notes */}
          <div className="pod-section">
            <label className="pod-label">{words.notesLabel}</label>
            <textarea
              value={podNotes}
              onChange={(e) => setPodNotes(e.target.value)}
              placeholder="Add any delivery details, such as slab orientation, site access instructions, or damage notes."
              /* no-capitalize opts out of the global title-casing in index.css,
                 which was turning "chipped edge on two slabs" into Title Case. */
              className="pod-textarea no-capitalize"
              rows={3}
            />
          </div>
        </div>

        <div className="pod-modal-footer">
          {!isReadyToSubmit && !isSaving && (
            <span className="pod-gate-msg">Still needed: {missingParts.join(', ')}</span>
          )}
          <button type="button" className="pod-btn-cancel" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="pod-btn-submit"
            onClick={handleSave}
            disabled={isSaving || isStampingPdf || !isReadyToSubmit}
          >
            {isStampingPdf
              ? <><Layers size={16} className="spin-icon" /> Signing PDF...</>
              : isSaving
                ? 'Saving ePOD...'
                : <><Check size={16} /> {words.submitLabel}</>}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PodModal;
