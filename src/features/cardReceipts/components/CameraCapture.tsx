import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Image as ImageIcon, X, Zap, ZapOff } from 'lucide-react';
import { lockPage, unlockPage } from '../../../components/shared/pageLock';
import { coverCrop } from '../../../utils/cameraCrop';

type Props = {
  /** The shot, once they tap Use photo (or one picked from the library). */
  onFile: (file: File) => void;
  onClose: () => void;
};

type Stage = 'starting' | 'live' | 'review' | 'blocked';

const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

/**
 * Add receipt → Open Camera (owner's design, 2026-11-21): a full-screen
 * viewfinder on the device's own camera (`getUserMedia`, back camera first) with
 * corner guides, a shutter, the photo library one tap away and a flash where the
 * camera has one; after the shot, "Check the photo" with Retake / Use photo.
 * Where there is no camera or it is blocked (or the browser can't do this), it
 * says so and offers the phone's own camera through a file input
 * (`capture="environment"`), so the way in never dead-ends. The shot is handed
 * back as a JPEG File, so it travels the same path as a picked photo.
 */
export default function CameraCapture({ onFile, onClose }: Props) {
  const [stage, setStage] = useState<Stage>('starting');
  const [shot, setShot] = useState<{ file: File; url: string } | null>(null);
  const [torch, setTorch] = useState<{ can: boolean; on: boolean }>({ can: false, on: false });
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const nativeRef = useRef<HTMLInputElement>(null);
  const shotUrl = useRef('');

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  const start = useCallback(async () => {
    setStage('starting');
    stop();
    if (!navigator.mediaDevices?.getUserMedia) { setStage('blocked'); return; }
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1920 } },
        audio: false
      });
      stream.current = s;
      const track = s.getVideoTracks()[0];
      const caps = (track?.getCapabilities?.() || {}) as { torch?: boolean };
      setTorch({ can: Boolean(caps.torch), on: false });
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play().catch(() => undefined);
      }
      setStage('live');
    } catch {
      setStage('blocked');
    }
  }, [stop]);

  useEffect(() => {
    lockPage();
    start();
    return () => { stop(); unlockPage(); if (shotUrl.current) URL.revokeObjectURL(shotUrl.current); };
  }, [start, stop]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const flip = async () => {
    const track = stream.current?.getVideoTracks()[0];
    if (!track) return;
    const on = !torch.on;
    try {
      await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
      setTorch({ can: true, on });
    } catch { setTorch({ can: false, on: false }); }
  };

  const snap = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    // A phone's viewfinder fills the screen (`object-fit: cover`), so the shot is cut to what
    // showed; a desktop's letterboxed one is saved whole.
    const covers = getComputedStyle(v).objectFit === 'cover';
    const { sx, sy, sw, sh } = covers ? coverCrop(v.videoWidth, v.videoHeight, v.clientWidth, v.clientHeight) : { sx: 0, sy: 0, sw: v.videoWidth, sh: v.videoHeight };
    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    canvas.getContext('2d')?.drawImage(v, sx, sy, sw, sh, 0, 0, sw, sh);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `receipt-${stamp()}.jpg`, { type: 'image/jpeg' });
      const url = URL.createObjectURL(file);
      if (shotUrl.current) URL.revokeObjectURL(shotUrl.current);
      shotUrl.current = url;
      setShot({ file, url });
      setStage('review');
    }, 'image/jpeg', 0.92);
  };

  const retake = () => { setShot(null); setStage('live'); video.current?.play().catch(() => undefined); };

  return createPortal(
    <div className="ccr-cam" role="dialog" aria-modal="true" aria-label="Take a photo of the receipt">
      <input ref={libraryRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />
      <input ref={nativeRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />

      <video ref={video} className="ccr-cam-video" playsInline muted autoPlay hidden={stage !== 'live' && stage !== 'starting'} />
      {stage === 'review' && shot ? <img className="ccr-cam-shot" src={shot.url} alt="The photo you took" /> : null}

      <div className="ccr-cam-top">
        <button type="button" className="ccr-cam-round" aria-label="Close camera" onClick={onClose}><X size={22} aria-hidden="true" /></button>
        <div className="ccr-cam-title">{stage === 'review' ? 'Check the photo' : 'Receipt'}</div>
        {stage === 'live' && torch.can
          ? <button type="button" className="ccr-cam-round" aria-label={torch.on ? 'Flash on' : 'Flash off'} aria-pressed={torch.on} onClick={flip}>{torch.on ? <Zap size={20} aria-hidden="true" /> : <ZapOff size={20} aria-hidden="true" />}</button>
          : <span className="ccr-cam-round is-gap" aria-hidden="true" />}
      </div>

      {stage === 'live' ? (
        <>
          <div className="ccr-cam-guide" aria-hidden="true"><i /><i /><i /><i /></div>
          <div className="ccr-cam-hint">Fit the whole receipt inside the corners</div>
          <div className="ccr-cam-bar">
            <button type="button" className="ccr-cam-lib" aria-label="Choose from photo library" onClick={() => libraryRef.current?.click()}><ImageIcon size={22} aria-hidden="true" /></button>
            <button type="button" className="ccr-cam-shutter" aria-label="Take photo" onClick={snap}><span /></button>
            <span className="ccr-cam-lib is-gap" aria-hidden="true" />
          </div>
        </>
      ) : null}

      {stage === 'starting' ? <div className="ccr-cam-msg"><span className="ccr-cam-spin" aria-hidden="true" />Starting the camera…</div> : null}

      {stage === 'review' && shot ? (
        <>
          <div className="ccr-cam-hint is-review">Can you read the total and the date? If not, retake it in better light.</div>
          <div className="ccr-cam-actions">
            <button type="button" className="ccr-cam-btn" onClick={retake}>Retake</button>
            <button type="button" className="ccr-cam-btn is-gold" onClick={() => onFile(shot.file)}>Use photo</button>
          </div>
        </>
      ) : null}

      {stage === 'blocked' ? (
        <div className="ccr-cam-msg is-blocked" role="alert">
          <b>The camera isn’t available here</b>
          <span>Allow camera access for this site in your browser’s settings and try again, or use your phone’s own camera.</span>
          <div className="ccr-cam-actions">
            <button type="button" className="ccr-cam-btn is-gold" onClick={() => nativeRef.current?.click()}>Use the phone camera</button>
            <button type="button" className="ccr-cam-btn" onClick={start}>Try again</button>
            <button type="button" className="ccr-cam-btn" onClick={() => libraryRef.current?.click()}>Choose a photo</button>
          </div>
        </div>
      ) : null}
    </div>,
    document.body
  );
}
