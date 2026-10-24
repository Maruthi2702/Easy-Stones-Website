// The ePOD signature pads' canvas work (PodModal): sizing a pad, drawing a
// stroke, ending and wiping one, and the "signed at" stamp. No React state —
// PodModal keeps whether each pad is signed and when.

import type { RefObject, TouchList } from 'react';

export type CanvasRef = RefObject<HTMLCanvasElement | null>;
/** A pad event: mouse or touch, read for its client position. */
export type PadEvent = { clientX?: number; clientY?: number; touches?: TouchList };

export const formatStamp = (value: string | null) => {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return `${d.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })} · ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
};

// `onUnreadable` runs when an earlier signature can't be loaded into the pad
// (its image didn't load, or the host wouldn't allow it to be read back): the
// pad is left blank and the caller marks it unsigned, so the person signs
// again instead of "saving" a signature that isn't there.
export const initCanvas = (ref: CanvasRef, sigDataUrl: string | null | undefined, onUnreadable?: () => void) => {
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

  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.strokeStyle = '#d4af37';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (sigDataUrl) {
    const img = new Image();
    // A signature saved online comes back as a hosted URL. Drawn without
    // this, it taints the canvas and toDataURL() throws on Save — which left
    // the button on "Saving…" for good. (Pads that start from a data: URL
    // don't need it.)
    if (!String(sigDataUrl).startsWith('data:')) img.crossOrigin = 'anonymous';
    img.onerror = () => { if (onUnreadable) onUnreadable(); };
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

export const drawOnPad = (e: PadEvent, ref: CanvasRef) => {
  const canvas = ref.current;
  if (!canvas) return;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const rect = canvas.getBoundingClientRect();
  let clientX = e.clientX as number;
  let clientY = e.clientY as number;

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

/** The pen lifted: close the stroke. False when the pad isn't mounted. */
export const endStroke = (ref: CanvasRef): boolean => {
  const canvas = ref.current;
  if (!canvas) return false;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.beginPath();
  return true;
};

/** Wipe a pad. False when the pad isn't mounted. */
export const wipePad = (ref: CanvasRef): boolean => {
  const canvas = ref.current;
  if (!canvas) return false;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  // Clear in device pixels — the context carries a devicePixelRatio scale.
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
  ctx.beginPath();
  return true;
};
