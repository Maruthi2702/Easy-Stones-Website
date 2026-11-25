/**
 * The part of a camera frame that shows on screen when the video fills its box with
 * `object-fit: cover` (a phone's full-screen viewfinder). The shot is cut to exactly
 * this, so what is saved is what the person saw — no hidden edges.
 * Sizes are the frame's (`vw`, `vh`) and the box's (`boxW`, `boxH`); the answer is in frame pixels.
 */
export function coverCrop(vw: number, vh: number, boxW: number, boxH: number): { sx: number; sy: number; sw: number; sh: number } {
  if (!(vw > 0 && vh > 0 && boxW > 0 && boxH > 0)) return { sx: 0, sy: 0, sw: Math.max(vw, 0), sh: Math.max(vh, 0) };
  const scale = Math.max(boxW / vw, boxH / vh);
  const sw = Math.min(vw, Math.round(boxW / scale));
  const sh = Math.min(vh, Math.round(boxH / scale));
  return { sx: Math.round((vw - sw) / 2), sy: Math.round((vh - sh) / 2), sw, sh };
}
