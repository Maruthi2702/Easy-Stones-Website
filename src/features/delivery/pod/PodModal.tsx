import React, { useState, useRef, useEffect } from 'react';
import { X, Check, Camera, Upload, FileText, ShieldCheck, Eye, Layers } from 'lucide-react';
import { formatTitleCase } from '../../../utils/textUtils';
import { packingListFileName, openPdfInline } from '../../../utils/packingList';
import { isPickupDelivery, wordingForTicket } from '../../../utils/deliveryPickup';
import SignaturePad from './SignaturePad';
import { drawOnPad, endStroke, initCanvas, wipePad } from './signatureCanvas';
import type { CanvasRef, PadEvent } from './signatureCanvas';
import type { CurrentUser } from '../../../types/records';
import type { BoardColumn, Ticket } from '../types';
import './PodModal.css';

type Setter<T> = React.Dispatch<React.SetStateAction<T>>;

export type PodModalProps = {
  isOpen: boolean;
  onClose: () => void;
  delivery: Ticket | null;
  trucks?: BoardColumn[];
  currentUser?: CurrentUser | null;
  /** Saves the ePOD; throws with a message to show. */
  onSavePod?: (pod: PodData) => Promise<unknown>;
};

/** What a signed ePOD sends (PATCH /api/deliveries/:id/pod). */
export type PodData = {
  signeeName: string;
  driverName: string;
  customerSignature: string;
  driverSignature: string;
  customerSignedAt: string;
  driverSignedAt: string;
  signedAt: Date;
  photos: string[];
  notes: string;
};

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
const PodModal = ({ isOpen, onClose, delivery, trucks = [], currentUser = null, onSavePod }: PodModalProps) => {
  const isPickup = isPickupDelivery(delivery, trucks);
  // wordingForTicket, not wordingFor: a return has to be recognised before the
  // pickup/delivery question, because it can arrive either way and its two
  // signature roles mean the opposite of everything else's.
  const words = wordingForTicket(delivery, trucks);

  const [signeeName, setSigneeName] = useState(delivery?.pod?.signeeName || '');
  const [podNotes, setPodNotes] = useState(delivery?.pod?.notes || '');
  const [photos, setPhotos] = useState<string[]>(delivery?.pod?.photos || []);
  const [, setUploadingPhoto] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isStampingPdf, setIsStampingPdf] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Canvas references for drawing signatures
  const custCanvasRef = useRef<HTMLCanvasElement>(null);
  const driverCanvasRef = useRef<HTMLCanvasElement>(null);

  const [isCustDrawing, setIsCustDrawing] = useState(false);
  const [isDriverDrawing, setIsDriverDrawing] = useState(false);

  const [hasCustSignature, setHasCustSignature] = useState(Boolean(delivery?.pod?.customerSignature));
  const [hasDriverSignature, setHasDriverSignature] = useState(Boolean(delivery?.pod?.driverSignature));

  // Each pad records its own time when the pen lifts. Stamping both at submit
  // would make the two dates identical and meaningless.
  const [custSignedAt, setCustSignedAt] = useState<string | null>(delivery?.pod?.customerSignedAt || null);
  const [driverSignedAt, setDriverSignedAt] = useState<string | null>(delivery?.pod?.driverSignedAt || null);

  // Which ticket the form was last filled in for (null while closed), and
  // whether anyone has typed, drawn or added a photo since. The board opens
  // this with its list copy of the ticket and swaps in the full record a moment
  // later (the list omits the signature images). That swap used to reset the
  // form — on a slow signal, wiping a signature already half drawn. Now it
  // only fills the form in while nothing has been entered; once someone has
  // started, the same ticket arriving again leaves their work alone.
  const filledFor = useRef<string | null>(null);
  const touched = useRef(false);
  const markTouched = () => { touched.current = true; };

  // Initialize canvas drawings if existing signature exists
  useEffect(() => {
    if (!isOpen) {
      filledFor.current = null;
      touched.current = false;
      return;
    }
    const id = delivery?.id ?? '';
    if (filledFor.current === id && touched.current) return;
    filledFor.current = id;
    touched.current = false;

    setSigneeName(delivery?.pod?.signeeName || '');
    setPodNotes(delivery?.pod?.notes || '');
    setPhotos(delivery?.pod?.photos || []);
    setHasCustSignature(Boolean(delivery?.pod?.customerSignature));
    setHasDriverSignature(Boolean(delivery?.pod?.driverSignature));
    setCustSignedAt(delivery?.pod?.customerSignedAt || null);
    setDriverSignedAt(delivery?.pod?.driverSignedAt || null);
    setError(null);

    const timer = setTimeout(() => {
      initCanvas(custCanvasRef, delivery?.pod?.customerSignature, () => setHasCustSignature(false));
      initCanvas(driverCanvasRef, delivery?.pod?.driverSignature, () => setHasDriverSignature(false));
    }, 100);
    return () => clearTimeout(timer);
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

  // Generic Touch / Mouse Handlers for Canvas Drawing
  const startDrawing = (e: PadEvent, ref: CanvasRef, setDrawing: Setter<boolean>) => {
    markTouched();
    setDrawing(true);
    drawOnPad(e, ref);
  };

  const stopDrawing = (setDrawing: Setter<boolean>, ref: CanvasRef, setHasSig: Setter<boolean>, setSignedAt: Setter<string | null>) => {
    setDrawing(false);
    if (endStroke(ref)) {
      setHasSig(true);
      setSignedAt(new Date().toISOString());
    }
  };

  const clearCanvas = (ref: CanvasRef, setHasSig: Setter<boolean>, setSignedAt: Setter<string | null>) => {
    markTouched();
    if (!wipePad(ref)) return;
    setHasSig(false);
    setSignedAt(null);
  };

  // Handle Photo Upload
  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files as FileList);
    if (files.length === 0) return;
    markTouched();

    setUploadingPhoto(true);
    // Convert to base64 preview or upload
    files.forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPhotos(prev => [...prev, reader.result as string].slice(0, 6));
        setUploadingPhoto(false);
      };
      reader.readAsDataURL(file);
    });
  };

  const removePhoto = (idx: number) => {
    markTouched();
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
    setIsStampingPdf(Boolean(delivery!.packingListUrl));
    setError(null);

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
    try {
      // Inside the try: reading a pad back throws if a hosted signature tainted
      // it, and out here that left the button on "Saving…" with no message.
      let custSigDataUrl = '';
      let driverSigDataUrl = '';
      try {
        custSigDataUrl = custCanvasRef.current ? custCanvasRef.current.toDataURL() : '';
        driverSigDataUrl = driverCanvasRef.current ? driverCanvasRef.current.toDataURL() : '';
      } catch {
        throw new Error('An earlier signature on this form couldn\'t be read. Press Clear on each signature and sign again.');
      }
      const podData: PodData = {
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
      if (onSavePod) {
        await onSavePod(podData);
      }
      onClose();
    } catch (err) {
      // No local-blob fallback: a blob: URL is meaningless to every other user
      // and used to be written to the database as if it were a real document.
      setError(
        (err as Error)?.message ||
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
              onChange={(e) => { markTouched(); setSigneeName(formatTitleCase(e.target.value)); }}
              placeholder={words.signeePlaceholder}
              className="pod-input-field"
            />
          </div>

          {/* Signature Canvas Grid */}
          <div className="pod-signature-grid">
            {/* Customer Signature Pad */}
            <SignaturePad
              label={words.customerSigLabel}
              hint={words.customerHint}
              canvasRef={custCanvasRef}
              signed={hasCustSignature}
              drawing={isCustDrawing}
              signedAt={custSignedAt}
              onClear={() => clearCanvas(custCanvasRef, setHasCustSignature, setCustSignedAt)}
              onStart={(e) => startDrawing(e, custCanvasRef, setIsCustDrawing)}
              onMove={(e) => drawOnPad(e, custCanvasRef)}
              onEnd={() => stopDrawing(setIsCustDrawing, custCanvasRef, setHasCustSignature, setCustSignedAt)}
            />

            {/* Driver Signature Pad */}
            <SignaturePad
              label={words.driverSigLabel}
              hint={words.driverHint}
              canvasRef={driverCanvasRef}
              signed={hasDriverSignature}
              drawing={isDriverDrawing}
              signedAt={driverSignedAt}
              onClear={() => clearCanvas(driverCanvasRef, setHasDriverSignature, setDriverSignedAt)}
              onStart={(e) => startDrawing(e, driverCanvasRef, setIsDriverDrawing)}
              onMove={(e) => drawOnPad(e, driverCanvasRef)}
              onEnd={() => stopDrawing(setIsDriverDrawing, driverCanvasRef, setHasDriverSignature, setDriverSignedAt)}
            />
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
              onChange={(e) => { markTouched(); setPodNotes(e.target.value); }}
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
