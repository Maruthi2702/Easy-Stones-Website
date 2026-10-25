import { describe, it, expect } from 'vitest';
import { estimateSkew, levelBy, rotatedSize, findTagBox, textBand, stretchContrast, rowSharpness, LEVEL_WITHIN } from './tagPhoto';

/**
 * Black bars on white running at `deg` (clockwise, y down), like a barcode or
 * text lines — edges smoothed (4×4 samples a pixel) the way a camera's are.
 */
function bars(deg, width = 320, height = 220, period = 10) {
  const a = (deg * Math.PI) / 180;
  const S = 4;
  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let dark = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const across = -(x + (sx + 0.5) / S) * Math.sin(a) + (y + (sy + 0.5) / S) * Math.cos(a);
          if (((Math.floor(across / (period / 2)) % 2) + 2) % 2) dark++;
        }
      }
      gray[y * width + x] = Math.round(235 - (215 * dark) / (S * S));
    }
  }
  return { gray, width, height };
}

const skewOf = ({ gray, width, height }) => estimateSkew(gray, width, height);

describe('estimateSkew', () => {
  it('finds the tilt of lines at any angle, folded into ±45°', () => {
    for (const [deg, expected] of [[0, 0], [7, 7], [12, 12], [-20, -20], [33, 33], [-40, -40], [60, -30], [-60, 30], [90, 0], [150, -30]]) {
      for (const period of [6, 10, 16]) {
        expect(Math.abs(skewOf(bars(deg, 320, 220, period)).angle - expected)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('counts lines across the text the same as along it (barcode bars vs. tag edges)', () => {
    expect(Math.abs(skewOf(bars(25)).angle - skewOf(bars(25 + 90)).angle)).toBeLessThanOrEqual(1);
  });

  it('says level (0) for a blank or patternless image', () => {
    const width = 200; const height = 150;
    expect(estimateSkew(new Uint8Array(width * height).fill(200), width, height).angle).toBe(0);
    // Concentric rings: edges in every direction, no one tilt.
    const rings = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rings[y * width + x] = Math.floor(Math.hypot(x - 100, y - 75) / 6) % 2 ? 30 : 230;
    expect(estimateSkew(rings, width, height).angle).toBe(0);
  });
});

describe('levelling', () => {
  it('leaves a nearly level photo alone', () => {
    expect(levelBy(0)).toBe(0);
    expect(levelBy(LEVEL_WITHIN - 0.5)).toBe(0);
    expect(levelBy(-(LEVEL_WITHIN - 0.5))).toBe(0);
    expect(levelBy(-43.5)).toBe(-43.5);
    expect(levelBy(12)).toBe(12);
  });

  it('makes room for the corners of a rotated photo', () => {
    expect(rotatedSize(400, 300, 0)).toEqual({ width: 400, height: 300 });
    expect(rotatedSize(400, 300, 90)).toEqual({ width: 300, height: 400 });
    expect(rotatedSize(400, 300, 45)).toEqual({ width: 495, height: 495 });
    expect(rotatedSize(400, 300, -30)).toEqual(rotatedSize(400, 300, 30));
  });
});

describe('findTagBox', () => {
  const W = 400; const H = 300;
  /** A light photo with a barcode (bars `period` px apart) at x0..x1, y0..y1. */
  function photoWithBarcode({ x0, x1, y0, y1, vertical = true, clutter = false }) {
    const gray = new Uint8Array(W * H).fill(205);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (clutter && x < 120) gray[i] = (x * 7 + y * 13) % 23 < 6 ? 60 : 200; // speckled, every direction
        if (x >= x0 && x < x1 && y >= y0 && y < y1) gray[i] = (vertical ? x : y) % 6 < 3 ? 15 : 245;
      }
    }
    return gray;
  }
  const contains = (box, { x0, x1, y0, y1 }) =>
    box.x <= (x0 / W) * 100 && box.y <= (y0 / H) * 100
    && box.x + box.width >= (x1 / W) * 100 && box.y + box.height >= (y1 / H) * 100;

  it('boxes the barcode and the text beside it, whichever way the bars run', () => {
    const across = { x0: 200, x1: 320, y0: 130, y1: 160 }; // vertical bars, barcode long across x
    const boxA = findTagBox(photoWithBarcode(across), W, H);
    expect(contains(boxA, across)).toBe(true);
    expect(boxA.height).toBeGreaterThan(((across.y1 - across.y0) / H) * 100 * 2); // room for the text line
    expect(boxA.width).toBeLessThan(100);

    const down = { x0: 180, x1: 210, y0: 60, y1: 200 }; // horizontal bars, barcode long down y
    const boxB = findTagBox(photoWithBarcode({ ...down, vertical: false }), W, H);
    expect(contains(boxB, down)).toBe(true);
    expect(boxB.width).toBeGreaterThan(((down.x1 - down.x0) / W) * 100 * 2);
  });

  it('isn’t fooled by clutter, and stays inside the photo', () => {
    const near = { x0: 300, x1: 398, y0: 250, y1: 298 };
    const box = findTagBox(photoWithBarcode({ ...near, clutter: true }), W, H);
    expect(contains(box, near)).toBe(true);
    expect(box.x + box.width).toBeLessThanOrEqual(100);
    expect(box.y + box.height).toBeLessThanOrEqual(100);
  });

  it('finds nothing in a photo without a barcode', () => {
    expect(findTagBox(new Uint8Array(W * H).fill(200), W, H)).toBeNull();
    expect(findTagBox(photoWithBarcode({ x0: 0, x1: 0, y0: 0, y1: 0, clutter: true }), W, H)).toBeNull();
  });
});

describe('textBand', () => {
  const W = 300; const H = 160;
  /**
   * A strip under a barcode: its last bars in rows 0–24 over columns 100–200
   * only (across the whole strip no darker than text), the printed line in
   * rows 40–60, then the slab below the tag — a dark shadow (rows 90–110,
   * more ink than the text) and grainy texture (rows 130–150).
   */
  function strip({ text = true, bars = true, below = true } = {}) {
    const g = new Uint8Array(W * H).fill(230);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (bars && y < 25 && x >= 100 && x < 200 && x % 4 < 2) g[i] = 20;
        // The bars' fading ends: thinner, letter-like, still in the barcode's columns.
        if (bars && y >= 25 && y < 33 && x >= 100 && x < 200 && x % 4 === 0) g[i] = 60;
        if (text && y >= 40 && y <= 60 && x % 12 < 2 && x > 20 && x < 280) g[i] = 30;
        if (below && y >= 90 && y <= 110 && x > 10) g[i] = 40;
        if (below && y >= 130 && y <= 150 && (x * 7 + y * 3) % 11 < 3) g[i] = 50;
      }
    }
    return g;
  }

  it('finds the printed line under the barcode’s bars, not the slab below the tag', () => {
    const band = textBand(strip(), W, H, { pad: 0, bars: [100, 200], minHeight: 12 });
    expect(band.top).toBeGreaterThanOrEqual(38);
    expect(band.top).toBeLessThanOrEqual(40);
    expect(band.bottom).toBeGreaterThanOrEqual(60);
    expect(band.bottom).toBeLessThanOrEqual(62);
    const padded = textBand(strip(), W, H, { pad: 0.5, bars: [100, 200], minHeight: 12 });
    expect(padded.top).toBeLessThan(35);
    expect(padded.bottom).toBeGreaterThan(65);
  });

  it('steps past bars that the print almost touches', () => {
    const g = strip();
    // Print starting 2 rows after the bars' fading ends.
    for (let y = 35; y < 40; y++) for (let x = 21; x < 280; x++) if (x % 12 < 2) g[y * W + x] = 30;
    const band = textBand(g, W, H, { pad: 0, bars: [100, 200], minHeight: 12 });
    expect(band.top).toBeGreaterThanOrEqual(33);
    expect(band.top).toBeLessThanOrEqual(36);
    expect(band.bottom).toBeGreaterThanOrEqual(60);
  });

  it('counts from the barcode’s side', () => {
    // A strip above the barcode ends at it: the line nearest the bottom.
    const band = textBand(strip({ bars: false }), W, H, { pad: 0, from: 'bottom' });
    expect(band.top).toBeGreaterThan(120);
  });

  it('finds nothing in a blank strip or one with only barcode and shadow', () => {
    expect(textBand(new Uint8Array(W * H).fill(200), W, H)).toBeNull();
    const g = strip({ text: false });
    for (let y = 130; y <= 150; y++) for (let x = 0; x < W; x++) g[y * W + x] = 230; // no texture either
    expect(textBand(g, W, H, { bars: [100, 200], minHeight: 12 })).toBeNull();
  });
});

describe('stretchContrast', () => {
  it('spreads dull grey print to black and white', () => {
    const gray = new Uint8Array(1000).map((_, i) => (i % 10 === 0 ? 120 : 180));
    const out = stretchContrast(gray);
    expect(Math.min(...out)).toBe(0);
    expect(Math.max(...out)).toBe(255);
  });
});

describe('rowSharpness', () => {
  /** A line of print (dashes) tilted by `deg`. */
  function line(deg) {
    const W = 400; const H = 80;
    const g = new Uint8Array(W * H).fill(230);
    const t = Math.tan((deg * Math.PI) / 180);
    for (let x = 20; x < 380; x++) {
      if (x % 10 >= 6) continue;
      const mid = 40 + (x - 200) * t;
      for (let y = Math.round(mid - 8); y <= Math.round(mid + 8); y++) if (y >= 0 && y < H) g[y * W + x] = 25;
    }
    return rowSharpness(g, W, H);
  }

  it('is highest when the line is level', () => {
    expect(line(0)).toBeGreaterThan(line(1));
    expect(line(1)).toBeGreaterThan(line(3));
    expect(line(0)).toBeGreaterThan(line(-2));
  });
});
