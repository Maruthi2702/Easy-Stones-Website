import { Check } from 'lucide-react';
import { formatStamp } from './signatureCanvas';
import type { CanvasRef, PadEvent } from './signatureCanvas';

export type SignaturePadProps = {
  label: string;
  /** Shown under the pad until it's signed; then the time it was signed. */
  hint: string;
  canvasRef: CanvasRef;
  signed: boolean;
  /** The pen is down: moves draw. */
  drawing: boolean;
  signedAt: string | null;
  onClear: () => void;
  onStart: (e: PadEvent) => void;
  onMove: (e: PadEvent) => void;
  onEnd: () => void;
};

/** One ePOD signature pad (PodModal): its label, Clear, the canvas, and the stamp or hint. */
export default function SignaturePad({ label, hint, canvasRef, signed, drawing, signedAt, onClear, onStart, onMove, onEnd }: SignaturePadProps) {
  return (
    <div className="pod-sig-box">
      <div className="sig-box-header">
        <label className="pod-label">{label} <span className="req-star">*</span></label>
        <button type="button" className="sig-clear-btn" onClick={onClear}>Clear</button>
      </div>
      <canvas
        ref={canvasRef}
        width={340}
        height={130}
        className={`sig-canvas ${signed ? 'is-signed' : ''}`}
        onMouseDown={(e) => onStart(e)}
        onMouseMove={(e) => drawing && onMove(e)}
        onMouseUp={() => onEnd()}
        onTouchStart={(e) => onStart(e)}
        onTouchMove={(e) => drawing && onMove(e)}
        onTouchEnd={() => onEnd()}
      />
      {formatStamp(signedAt)
        ? <span className="sig-stamp"><Check size={11} /> Signed {formatStamp(signedAt)}</span>
        : <span className="sig-hint">{hint}</span>}
    </div>
  );
}
