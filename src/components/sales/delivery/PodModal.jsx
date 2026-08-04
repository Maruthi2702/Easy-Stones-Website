import React, { useState, useRef, useEffect } from 'react';
import { X, Check, Trash2, Camera, Upload, FileText, Calendar, Clock, User, ShieldCheck, Download, Layers } from 'lucide-react';
import { API_URL } from '../../../config/api';
import { stampSignaturesOnPdf } from '../../../utils/pdfSigner';
import { formatTitleCase } from '../../../utils/textUtils';
import './PodModal.css';

/**
 * Proof of Delivery (ePOD) Modal component
 * Captures Customer Signee Name, Touchscreen Customer Signature, Driver Signature,
 * and 1-4 Delivered Slab Photos.
 */
const PodModal = ({ isOpen, onClose, delivery, trucks = [], currentUser = null, onSavePod }) => {
  const [signeeName, setSigneeName] = useState(delivery?.pod?.signeeName || '');
  const [podNotes, setPodNotes] = useState(delivery?.pod?.notes || '');
  const [photos, setPhotos] = useState(delivery?.pod?.photos || []);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
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

  // Initialize canvas drawings if existing signature exists
  useEffect(() => {
    if (isOpen) {
      setSigneeName(delivery?.pod?.signeeName || '');
      setPodNotes(delivery?.pod?.notes || '');
      setPhotos(delivery?.pod?.photos || []);
      setHasCustSignature(Boolean(delivery?.pod?.customerSignature));
      setHasDriverSignature(Boolean(delivery?.pod?.driverSignature));

      setTimeout(() => {
        initCanvas(custCanvasRef, delivery?.pod?.customerSignature);
        initCanvas(driverCanvasRef, delivery?.pod?.driverSignature);
      }, 100);
    }
  }, [isOpen, delivery]);

  const initCanvas = (ref, sigDataUrl) => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';

    if (sigDataUrl) {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
      };
      img.src = sigDataUrl;
    }
  };

  // Generic Touch / Mouse Handlers for Canvas Drawing
  const startDrawing = (e, ref, setDrawing) => {
    setDrawing(true);
    draw(e, ref);
  };

  const stopDrawing = (setDrawing, ref, setHasSig) => {
    setDrawing(false);
    const canvas = ref.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.beginPath();
      setHasSig(true);
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

  const clearCanvas = (ref, setHasSig) => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    setHasSig(false);
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
      setError('Please enter the customer signee name.');
      return;
    }
    if (!hasCustSignature) {
      setError('Customer signature is required.');
      return;
    }

    setIsSaving(true);
    setError(null);

    const custSigDataUrl = custCanvasRef.current ? custCanvasRef.current.toDataURL() : '';
    const driverSigDataUrl = driverCanvasRef.current ? driverCanvasRef.current.toDataURL() : '';
    const signedAt = new Date();

    const resolvedDriverName = (
      currentUser?.name ||
      currentUser?.username ||
      (delivery?.pod?.driverName && delivery.pod.driverName !== 'Driver' ? delivery.pod.driverName : '') ||
      delivery?.driverName ||
      delivery?.truckDriver ||
      delivery?.driver ||
      'Driver'
    );

    // ── Stamp signatures onto the packing list PDF ──────────────────────────
    let signedPdfUrl = null;
    let signedPdfFilename = null;

    if (delivery.packingListUrl) {
      try {
        setIsStampingPdf(true);
        const deliveryInfo = [
          delivery.soNumber ? `SO# ${delivery.soNumber}` : '',
          delivery.customerName || '',
          delivery.date || ''
        ].filter(Boolean).join(' - ');

        const signedBlob = await stampSignaturesOnPdf({
          pdfUrl: delivery.packingListUrl,
          customerSignatureDataUrl: custSigDataUrl,
          driverSignatureDataUrl: driverSigDataUrl,
          signeeName: signeeName.trim(),
          driverName: resolvedDriverName,
          deliveryInfo,
          signedAt
        });

        // Upload the signed PDF to server
        try {
          const formData = new FormData();
          const filename = `signed_packing_list_${delivery.soNumber || delivery.id || Date.now()}.pdf`;
          formData.append('file', signedBlob, filename);
          const token = localStorage.getItem('token') || localStorage.getItem('adminToken');
          const uploadRes = await fetch(`${API_URL}/api/deliveries/upload-packing-list`, {
            method: 'POST',
            headers: token ? { 'Authorization': `Bearer ${token}` } : {},
            body: formData
          });
          if (uploadRes.ok) {
            const uploadData = await uploadRes.json();
            signedPdfUrl = uploadData.url;
            signedPdfFilename = filename;
            console.log('[PodModal] Signed PDF uploaded:', signedPdfUrl);
          } else {
            // Fallback: create a local object URL for download
            signedPdfUrl = URL.createObjectURL(signedBlob);
            signedPdfFilename = `signed_packing_list_${Date.now()}.pdf`;
            console.warn('[PodModal] Upload failed, using object URL');
          }
        } catch (uploadErr) {
          // Fallback: create a local object URL for download
          signedPdfUrl = URL.createObjectURL(signedBlob);
          signedPdfFilename = `signed_packing_list_${Date.now()}.pdf`;
          console.warn('[PodModal] Upload error, using object URL:', uploadErr);
        }
      } catch (stampErr) {
        console.warn('[PodModal] PDF stamp failed, continuing without:', stampErr);
      } finally {
        setIsStampingPdf(false);
      }
    }

    const podData = {
      signeeName: signeeName.trim(),
      driverName: resolvedDriverName,
      customerSignature: custSigDataUrl,
      driverSignature: driverSigDataUrl,
      signedAt,
      photos,
      notes: podNotes,
      // URL of the signed PDF (packing list + overlaid signatures)
      signedPdfUrl: signedPdfUrl || null,
      signedPdfFilename: signedPdfFilename || null
    };

    try {
      if (onSavePod) {
        await onSavePod(podData);
      }
      onClose();
    } catch (err) {
      setError('Failed to save Proof of Delivery.');
    } finally {
      setIsSaving(false);
      setIsStampingPdf(false);
    }
  };

  if (!isOpen || !delivery) return null;

  return (
    <div className="pod-modal-overlay">
      <div className="pod-modal-content">
        <div className="pod-modal-header">
          <div className="pod-title-block">
            <h3><ShieldCheck size={20} className="pod-icon" /> Electronic Proof of Delivery (ePOD)</h3>
            <span className="pod-subtitle">Delivery #{delivery.soNumber || delivery.id} • {delivery.customerName}</span>
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
                <span>{delivery.packingListFilename || 'PackingList.pdf'}</span>
              </div>
              <a
                href={delivery.packingListUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="pod-view-pdf-btn"
              >
                <Download size={14} /> Open PDF
              </a>
            </div>
          )}

          {/* Signee Customer Information */}
          <div className="pod-section">
            <label className="pod-label">Customer Signee Full Name <span className="req-star">*</span></label>
            <input
              type="text"
              value={signeeName}
              onChange={(e) => setSigneeName(formatTitleCase(e.target.value))}
              placeholder="e.g. Marcus Johnson"
              className="pod-input-field"
            />
          </div>

          {/* Signature Canvas Grid */}
          <div className="pod-signature-grid">
            {/* Customer Signature Pad */}
            <div className="pod-sig-box">
              <div className="sig-box-header">
                <label className="pod-label">Customer Signature <span className="req-star">*</span></label>
                <button type="button" className="sig-clear-btn" onClick={() => clearCanvas(custCanvasRef, setHasCustSignature)}>Clear</button>
              </div>
              <canvas
                ref={custCanvasRef}
                width={340}
                height={130}
                className="sig-canvas"
                onMouseDown={(e) => startDrawing(e, custCanvasRef, setIsCustDrawing)}
                onMouseMove={(e) => isCustDrawing && draw(e, custCanvasRef)}
                onMouseUp={() => stopDrawing(setIsCustDrawing, custCanvasRef, setHasCustSignature)}
                onTouchStart={(e) => startDrawing(e, custCanvasRef, setIsCustDrawing)}
                onTouchMove={(e) => isCustDrawing && draw(e, custCanvasRef)}
                onTouchEnd={() => stopDrawing(setIsCustDrawing, custCanvasRef, setHasCustSignature)}
              />
              <span className="sig-hint">Sign above using touchscreen finger or stylus</span>
            </div>

            {/* Driver Signature Pad */}
            <div className="pod-sig-box">
              <div className="sig-box-header">
                <label className="pod-label">Driver Signature</label>
                <button type="button" className="sig-clear-btn" onClick={() => clearCanvas(driverCanvasRef, setHasDriverSignature)}>Clear</button>
              </div>
              <canvas
                ref={driverCanvasRef}
                width={340}
                height={130}
                className="sig-canvas"
                onMouseDown={(e) => startDrawing(e, driverCanvasRef, setIsDriverDrawing)}
                onMouseMove={(e) => isDriverDrawing && draw(e, driverCanvasRef)}
                onMouseUp={() => stopDrawing(setIsDriverDrawing, driverCanvasRef, setHasDriverSignature)}
                onTouchStart={(e) => startDrawing(e, driverCanvasRef, setIsDriverDrawing)}
                onTouchMove={(e) => isDriverDrawing && draw(e, driverCanvasRef)}
                onTouchEnd={() => stopDrawing(setIsDriverDrawing, driverCanvasRef, setHasDriverSignature)}
              />
              <span className="sig-hint">Driver sign-off confirmation</span>
            </div>
          </div>

          {/* Photos Upload Section */}
          <div className="pod-section">
            <div className="sig-box-header" style={{ marginBottom: '0.45rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label className="pod-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, margin: 0 }}>
                <Camera size={15} /> Delivered Slab Inspection Photos
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
            <label className="pod-label">Delivery Completion Notes</label>
            <textarea
              value={podNotes}
              onChange={(e) => setPodNotes(e.target.value)}
              placeholder="Add any delivery details, such as slab orientation, site access instructions, or damage notes."
              className="pod-textarea"
              rows={3}
            />
          </div>
        </div>

        <div className="pod-modal-footer">
          <button type="button" className="pod-btn-cancel" onClick={onClose}>Cancel</button>
          <button type="button" className="pod-btn-submit" onClick={handleSave} disabled={isSaving || isStampingPdf}>
            {isStampingPdf
              ? <><Layers size={16} className="spin-icon" /> Signing PDF...</>
              : isSaving
                ? 'Saving ePOD...'
                : <><Check size={16} /> Complete Delivery &amp; Sign PDF</>}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PodModal;
