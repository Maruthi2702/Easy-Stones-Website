/**
 * Where the slab tag is in a photo, for the Selection Sheet's tag scanner:
 * how far it's tilted (so the photo can be turned level before framing and
 * OCR) and where its barcode is (so the framing box starts around the tag,
 * not the whole photo). Pure — grey pixels in, numbers out — so it's tested
 * in tagPhoto.test.js; the canvas half is selectionSheet/tagImage.js.
 *
 * Why: Tesseract reads text that's upright, sideways or upside down (the scan
 * tries all four), but not text at an angle in between, and not a small tag
 * in a big busy photo. A tag shot at 30–60° failed every pass, and a
 * rectangle can't be fitted around a diagonal tag.
 */

// Edges weaker than this (Scharr magnitude on 0–255 grey, after the blur)
// are noise or shading, not strokes; a black-on-white stroke is ~1000–3000.
/** width*height grey values, 0–255, row by row. */
export type Gray = ArrayLike<number>;

const MIN_EDGE = 300;
// A tilt only counts when its pile of edges stands this many times above
// the average direction; otherwise there's no clear line to level.
const MIN_PEAK_RATIO = 1.6;
// Within this of level, leave the photo alone — Tesseract handles a few degrees.
export const LEVEL_WITHIN = 4;

/** Scharr gradient at pixel i (Sobel leans toward some directions by several degrees). */
function gradient(gray: Gray, i: number, width: number): [number, number] {
  const gx = 3 * (gray[i - width + 1] + gray[i + width + 1] - gray[i - width - 1] - gray[i + width - 1]) + 10 * (gray[i + 1] - gray[i - 1]);
  const gy = 3 * (gray[i + width - 1] + gray[i + width + 1] - gray[i - width - 1] - gray[i - width + 1]) + 10 * (gray[i + width] - gray[i - width]);
  return [gx, gy];
}

/** 3×3 average (border pixels left as they are). */
function boxBlur(src: Gray, width: number, height: number): Float32Array {
  const out = Float32Array.from(src);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      out[i] = (src[i - width - 1] + src[i - width] + src[i - width + 1] + src[i - 1] + src[i] + src[i + 1]
        + src[i + width - 1] + src[i + width] + src[i + width + 1]) / 9;
    }
  }
  return out;
}

/**
 * The tag's barcode bars, letter strokes and edges all run along or across
 * its text line, so their edges' directions, folded into 0–90°, pile up at
 * the tilt. Folding by 90° counts "along" and "across" together; a 90°
 * mix-up doesn't matter, since the scan still tries all four rotations.
 *
 * @param {ArrayLike<number>} gray  width*height grey values, 0–255, row by row
 * @returns {{ angle: number, strength: number }}  angle in (-45, 45] degrees,
 *   clockwise on screen (y down); rotating the photo by -angle levels it.
 *   0 when there's no clear direction.
 */
export function estimateSkew(rawGray: Gray, width: number, height: number): { angle: number; strength: number } {
  // Blur first: a sharp edge at an angle is a pixel staircase, and the
  // stairs' own edges pull the directions toward 0°, 27° and 45°.
  const gray = boxBlur(boxBlur(rawGray, width, height), width, height);
  const bins = new Float64Array(90);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const [gx, gy] = gradient(gray, y * width + x, width);
      const mag = Math.hypot(gx, gy);
      if (mag < MIN_EDGE) continue;
      const deg = ((Math.atan2(gy, gx) * 180) / Math.PI % 90 + 90) % 90;
      // Split between the two nearest 1° bins so the peak isn't quantised.
      const lo = Math.floor(deg);
      const t = deg - lo;
      bins[lo % 90] += mag * (1 - t);
      bins[(lo + 1) % 90] += mag * t;
    }
  }

  // Smooth around the circle (±3°) — strokes are a few degrees off each other.
  const smooth = new Float64Array(90);
  for (let b = 0; b < 90; b++) {
    for (let d = -3; d <= 3; d++) smooth[b] += bins[(b + d + 90) % 90] * (4 - Math.abs(d));
  }
  let peak = 0;
  for (let b = 1; b < 90; b++) if (smooth[b] > smooth[peak]) peak = b;
  const mean = smooth.reduce((s, v) => s + v, 0) / 90;
  const strength = mean > 0 ? smooth[peak] / mean : 0;
  if (strength < MIN_PEAK_RATIO) return { angle: 0, strength };

  // Parabola through the peak and its neighbours for a sub-degree answer.
  const l = smooth[(peak + 89) % 90];
  const r = smooth[(peak + 1) % 90];
  const denom = l - 2 * smooth[peak] + r;
  const at = peak + (denom ? (0.5 * (l - r)) / denom : 0);
  const folded = ((at % 90) + 90) % 90;
  const angle = folded > 45 ? folded - 90 : folded;
  return { angle: Math.round(angle * 10) / 10, strength };
}

/** The tilt to level by: the estimate, or 0 when it's close enough to level already. */
export const levelBy = (skew: number): number => (Math.abs(skew) < LEVEL_WITHIN ? 0 : skew);

/** Size of a width×height photo once rotated by `degrees` (the corners need room). */
export function rotatedSize(width: number, height: number, degrees: number) {
  const a = (degrees * Math.PI) / 180;
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  return { width: Math.round(width * c + height * s), height: Math.round(width * s + height * c) };
}

// Barcode cells: this share of a cell's pixels are strong edges, nearly all
// one way (across the bars).
const BAR_EDGE = 900;
const BAR_DENSITY = 0.18;

/**
 * Where the tag is in a levelled photo, found by its barcode: the biggest
 * block of dense, parallel edges that's long across its bars. Background
 * clutter (shelves, the warehouse) has edges every which way; slab edges are
 * single lines, not dense. The box grows from the barcode to take in the
 * text line printed alongside it (lot, slab, size, material).
 *
 * @returns {{ x, y, width, height } | null}  percent of the photo, or null
 *   when there's no barcode (the box then starts on the whole photo)
 */
export function findTagBox(gray: Gray, width: number, height: number, { cell = 8 }: { cell?: number } = {}): { x: number; y: number; width: number; height: number } | null {
  const cols = Math.floor(width / cell);
  const rows = Math.floor(height / cell);
  if (cols < 3 || rows < 3) return null;
  const n = cols * rows;
  const ex = new Float32Array(n); // edges across x (vertical bars)
  const ey = new Float32Array(n); // edges across y (horizontal bars)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const [gx, gy] = gradient(gray, y * width + x, width);
      if (Math.hypot(gx, gy) < BAR_EDGE) continue;
      const c = Math.min(rows - 1, Math.floor(y / cell)) * cols + Math.min(cols - 1, Math.floor(x / cell));
      if (Math.abs(gx) > 2.5 * Math.abs(gy)) ex[c]++;
      else if (Math.abs(gy) > 2.5 * Math.abs(gx)) ey[c]++;
    }
  }

  let best: { across: string; count: number; x: number; y: number; w: number; h: number } | null = null;
  for (const [across, mine, other] of [['x', ex, ey], ['y', ey, ex]] as [string, Float32Array, Float32Array][]) {
    const isBar = new Uint8Array(n);
    for (let c = 0; c < n; c++) isBar[c] = mine[c] / (cell * cell) > BAR_DENSITY && mine[c] > 3 * other[c] ? 1 : 0;
    const seen = new Uint8Array(n);
    for (let start = 0; start < n; start++) {
      if (!isBar[start] || seen[start]) continue;
      const stack = [start];
      seen[start] = 1;
      let count = 0; let x0 = cols; let y0 = rows; let x1 = -1; let y1 = -1;
      while (stack.length) {
        const c = stack.pop() as number;
        const cx = c % cols;
        const cy = (c - cx) / cols;
        count++;
        x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const nc = ny * cols + nx;
          if (isBar[nc] && !seen[nc]) { seen[nc] = 1; stack.push(nc); }
        }
      }
      // A barcode is at least twice as long (across its bars) as it is
      // thick, and mostly filled in.
      const w = x1 - x0 + 1;
      const h = y1 - y0 + 1;
      const long = across === 'x' ? w : h;
      const thick = across === 'x' ? h : w;
      if (count < 6 || long < 2 * thick || count < 0.5 * w * h) continue;
      if (!best || count > best.count) best = { across, count, x: x0 * cell, y: y0 * cell, w: w * cell, h: h * cell };
    }
  }
  if (!best) return null;

  // The text line runs alongside the barcode and is longer than it: take in
  // 60% more of its length each way and 1.6 of its thickness each side.
  const { x, y, w, h } = best;
  const box = best.across === 'x'
    ? { x0: x - 0.6 * w, x1: x + 1.6 * w, y0: y - 1.6 * h, y1: y + 2.6 * h }
    : { x0: x - 1.6 * w, x1: x + 2.6 * w, y0: y - 0.6 * h, y1: y + 1.6 * h };
  const pct = (v: number, size: number) => Math.max(0, Math.min(100, Math.round((v / size) * 100)));
  const left = pct(box.x0, width);
  const top = pct(box.y0, height);
  // At least 10% each way (the framing sliders' minimum), inside the photo.
  const bw = Math.max(10, pct(box.x1, width) - left);
  const bh = Math.max(10, pct(box.y1, height) - top);
  return { x: Math.min(left, 100 - bw), y: Math.min(top, 100 - bh), width: bw, height: bh };
}

/**
 * The printed line inside a strip cut beside a barcode. The strip also
 * catches the barcode's own bars, bare tag, and below the tag the slab's
 * edge, shadows and texture. Text rows are told apart by letters: many short
 * dark/light switches along the row, where a shadow or edge is long dark
 * runs. The barcode's columns (`bars`: [x0, x1]) say where to step past its
 * bars first. The line is the first text-like run at least
 * `minHeight` rows tall counting from the barcode (`from`: 'top' when the
 * strip starts on the barcode, 'bottom' when it ends on it), padded by `pad`
 * of its height; null when there's none.
 */
export function textBand(
  gray: Gray, width: number, height: number,
  { pad = 0.3, bars = null, from = 'top', minHeight = 6 }: { pad?: number; bars?: [number, number] | null; from?: 'top' | 'bottom'; minHeight?: number } = {}
): { top: number; bottom: number } | null {
  const sorted = Array.from(gray).sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.05)];
  const hi = sorted[Math.floor(sorted.length * 0.95)];
  if (hi - lo < 40) return null; // flat: no print at all
  const cut = (lo + hi) / 2;
  const [b0, b1] = bars ? [Math.max(0, Math.floor(bars[0])), Math.min(width, Math.ceil(bars[1]))] : [-1, -1];
  const minSwitches = Math.max(12, Math.round(width * 0.01));
  const text = new Uint8Array(height);
  for (let y = 0; y < height; y++) {
    let dark = 0; let switches = 0; let prev = false;
    for (let x = 0; x < width; x++) {
      const d = gray[y * width + x] < cut;
      if (d) dark++;
      if (x && d !== prev) switches++;
      prev = d;
    }
    text[y] = switches >= minSwitches && dark / width < 0.45 ? 1 : 0;
  }
  // Step past the barcode first. The strip starts (or, from 'bottom', ends)
  // on the line zxing read through the bars; follow each bar from there to
  // where it stops. Bars all stop on about the same row and letters fall
  // anywhere, so the middle stopping row is where the barcode ends, even
  // when the print almost touches it.
  let first = 0;
  let last = height - 1;
  if (b1 > b0) {
    const start = from === 'bottom' ? height - 1 : 0;
    const step = from === 'bottom' ? -1 : 1;
    const ends: number[] = [];
    for (let x = b0; x < b1; x++) {
      if (gray[start * width + x] >= cut) continue; // a space between bars
      let y = start;
      while (y + step >= 0 && y + step < height && (gray[(y + step) * width + x] < cut || (y + 2 * step >= 0 && y + 2 * step < height && gray[(y + 2 * step) * width + x] < cut))) y += step;
      ends.push(y);
    }
    if (ends.length) {
      ends.sort((a, b) => a - b);
      const end = ends[Math.floor(ends.length / 2)];
      if (from === 'bottom') last = Math.max(0, end - 2); else first = Math.min(height - 1, end + 2);
    }
  }
  // Runs of text rows, allowing 2-row gaps (between the parts of letters).
  const runs: { top: number; bottom: number }[] = [];
  for (let y = first; y <= last;) {
    if (!text[y]) { y++; continue; }
    let end = y; let gap = 0;
    for (let k = y; k <= last; k++) {
      if (text[k]) { end = k; gap = 0; } else if (++gap > 2) break;
    }
    // Shorter than a line of print: leftover bar ends, a scratch.
    if (end - y + 1 >= minHeight) runs.push({ top: y, bottom: end });
    y = end + 1;
  }
  const run = from === 'bottom' ? runs[runs.length - 1] : runs[0];
  if (!run) return null;
  const h = run.bottom - run.top + 1;
  return {
    top: Math.max(0, Math.floor(run.top - pad * h)),
    bottom: Math.min(height - 1, Math.ceil(run.bottom + pad * h)),
  };
}

/** Stretch grey levels so the darkest 2% is black and the lightest 2% white (glare-dulled print reads better). */
export function stretchContrast(gray: Gray): Uint8ClampedArray {
  const sorted = Array.from(gray).sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.02)];
  const hi = sorted[Math.floor(sorted.length * 0.98)];
  const out = new Uint8ClampedArray(gray.length);
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < gray.length; i++) out[i] = ((gray[i] - lo) * 255) / range;
  return out;
}

/**
 * How cleanly a strip's ink falls into rows: the sum of squared dark-pixel
 * counts per row. A level line of print packs its ink into a few rows (high);
 * the same line tilted smears it over many (low) — so of a few slightly
 * different turns of a strip, the highest is the level one.
 */
export function rowSharpness(gray: Gray, width: number, height: number): number {
  const sorted = Array.from(gray).sort((a, b) => a - b);
  const cut = (sorted[Math.floor(sorted.length * 0.05)] + sorted[Math.floor(sorted.length * 0.95)]) / 2;
  let score = 0;
  for (let y = 0; y < height; y++) {
    let dark = 0;
    for (let x = 0; x < width; x++) if (gray[y * width + x] < cut) dark++;
    score += dark * dark;
  }
  return score;
}
