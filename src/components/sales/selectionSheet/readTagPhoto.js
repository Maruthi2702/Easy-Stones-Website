/**
 * Selection Sheet tag scan: one photo in, sheet rows out. Loaded only when
 * someone scans (zxing's barcode reader and Tesseract are big).
 *
 * 1. Find every barcode in the photo (zxing — any angle, several tags).
 * 2. For each, turn the photo so the barcode reads left to right and cut out
 *    the strip under it, where the tag's one printed line is
 *    ("13583 - 51 / (8/13583) / 1265 / 137x79 / Mystique SJ MQ 3CM"); trim
 *    to the line, stretch the contrast, and OCR it as a single line, two ways.
 * 3. Combine the tags' reads (src/utils/tagLine.js): fields by majority, the
 *    printed lot copies checked against each other and the photo's other
 *    tags, one row per lot with its slabs together.
 * No barcode readable → the older whole-tag OCR (level the photo, find the
 * tag, try every rotation — scanTag.js).
 */
import { readBarcodes, prepareZXingModule } from 'zxing-wasm/reader';
import zxingWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { textBand, stretchContrast, rowSharpness } from '../../../utils/tagPhoto';
import { combineTagReads, closestProduct } from '../../../utils/tagLine';
import { loadImage, newCanvas, greyPixels, drawTurned, fitScale, levelledTagArea } from './tagImage';
import { scanTag } from './scanTag';

// The reader's .wasm ships with the app (Vite copies it), not from a CDN.
prepareZXingModule({
  overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? zxingWasmUrl : prefix + path) },
});

// Sizes (longest side) the photo is searched for barcodes at: a far-off tag
// needs detail, a close one reads better smaller. Every size is tried and the
// finds combined, so a tag one size misses another can catch.
const DETECT_DIMS = [2000, 3000, 1200];
// Characters a tag line is printed with; anything else OCR "sees" is noise.
const TAG_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz/()-x. ';

async function findBarcodes(img) {
  const byText = new Map();
  for (const scale of [...new Set(DETECT_DIMS.map((d) => fitScale(img.width, img.height, d)))]) {
    const canvas = drawTurned(img, { scale });
    const imageData = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
    const found = await readBarcodes(imageData, { tryHarder: true, tryRotate: true, tryInvert: false, maxNumberOfSymbols: 12 });
    for (const r of found) {
      if (!r.isValid || !r.text || byText.has(r.text)) continue;
      const at = (p) => ({ x: p.x / scale, y: p.y / scale });
      const { topLeft, topRight, bottomLeft } = r.position;
      byText.set(r.text, { text: r.text, topLeft: at(topLeft), topRight: at(topRight), bottomLeft: at(bottomLeft) });
    }
  }
  return [...byText.values()];
}

/** Draws the photo in a barcode's frame: u along it from `origin`, v across it, `s` px per photo px. */
function inBarcodeFrame(img, origin, angle, { u0, u1, v0, v1, s }) {
  const { canvas, ctx } = newCanvas((u1 - u0) * s, (v1 - v0) * s);
  ctx.translate(-u0 * s, -v0 * s);
  ctx.scale(s, s);
  ctx.rotate(-angle);
  ctx.translate(-origin.x, -origin.y);
  ctx.drawImage(img, 0, 0);
  return canvas;
}

/**
 * The strip beside one barcode, level and enlarged so its text is ~45px
 * tall: below the barcode (where the line is printed) or, as a second
 * try, above it.
 */
function cutStrip(img, code, side) {
  const { topLeft: tl, topRight: tr, bottomLeft: bl } = code;
  const len = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const thick = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  // zxing reads a 1D barcode along rows or columns, so its position is the
  // line it read and its angle only the nearest quarter turn; a tag a couple
  // of degrees off would drift out of a long, thin strip. Level it on the
  // print itself: of small turns either way, keep the one whose ink lines up
  // in the fewest rows (rowSharpness), measured small and quick.
  const rough = Math.atan2(tr.y - tl.y, tr.x - tl.x);
  const near = side === 'below' ? { v0: 0, v1: 0.22 * len } : { v0: -0.22 * len, v1: 0 };
  let angle = rough;
  let best = -1;
  for (let deg = -5; deg <= 5; deg += 0.5) {
    const a = rough + (deg * Math.PI) / 180;
    const c = inBarcodeFrame(img, tl, a, { u0: -0.9 * len, u1: 1.9 * len, ...near, s: Math.min(1, 700 / (2.8 * len)) });
    const score = rowSharpness(greyPixels(c), c.width, c.height);
    if (score > best) { best = score; angle = a; }
  }

  // In the barcode's frame (u along it, v across, down): the line is longer
  // than the barcode and printed just past its bars. The strip starts on the
  // line zxing read through the bars; textBand steps past what's left of them.
  const u0 = -0.9 * len;
  const u1 = 1.9 * len;
  const [v0, v1] = side === 'below' ? [0, thick + 0.35 * len] : [-0.35 * len, 0];
  const s = Math.min(3, 800 / len, 3600 / (u1 - u0));
  const canvas = inBarcodeFrame(img, tl, angle, { u0, u1, v0, v1, s });
  // Where the barcode's columns are in the strip, so its bars aren't taken for text.
  canvas.bars = [-u0 * s, (len - u0) * s];
  return canvas;
}

/** The strip trimmed to its printed line (`pad` of the line's height around it), contrast stretched. */
function lineImage(strip, pad, from) {
  const gray = greyPixels(strip);
  // Print is ~45px tall at the strip's scale; anything under 18 rows isn't a line of it.
  const band = textBand(gray, strip.width, strip.height, { pad, bars: strip.bars, from, minHeight: 18 }) || { top: 0, bottom: strip.height - 1 };
  const height = band.bottom - band.top + 1;
  const stretched = stretchContrast(gray.subarray(band.top * strip.width, (band.bottom + 1) * strip.width));
  const { canvas, ctx } = newCanvas(strip.width, height);
  const out = ctx.createImageData(strip.width, height);
  for (let i = 0; i < stretched.length; i++) {
    out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = stretched[i];
    out.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

const hasLotAndSlab = (text) => /\d{4,6}\s*-\s*\d{1,3}/.test(text);

/**
 * @param {File|Blob} file  the photo
 * @param {object[]} productList  the catalog, for materials' exact names
 * @param {(percent: number) => void} [onProgress]
 * @returns {Promise<{ ok: true, rows: {material, lot, details, size, notes: string[]}[], unread: number } | { ok: false }>}
 */
export async function readTagPhoto(file, productList = [], onProgress) {
  const img = await loadImage(file);
  onProgress?.(5);
  const codes = await findBarcodes(img);
  onProgress?.(25);

  if (codes.length) {
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('eng');
    try {
      await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: TAG_CHARS });
      const tags = [];
      for (const [n, code] of codes.entries()) {
        const texts = [];
        for (const side of ['below', 'above']) {
          const strip = cutStrip(img, code, side);
          for (const pad of [0.35, 0.8]) {
            const { data } = await worker.recognize(lineImage(strip, pad, side === 'below' ? 'top' : 'bottom'));
            texts.push(data.text);
          }
          if (texts.some(hasLotAndSlab)) break; // found the line; no need to look above
        }
        tags.push({ code: code.text, texts });
        onProgress?.(25 + Math.round(((n + 1) / codes.length) * 70));
      }
      const { rows, unread } = combineTagReads(tags, productList);
      if (rows.length) return { ok: true, rows, unread };
    } finally {
      worker.terminate().catch(() => {});
    }
  }

  // No barcode, or none of the lines read: OCR the whole tag area instead.
  const area = await levelledTagArea(img);
  const result = await scanTag(area, productList, (p) => onProgress?.(25 + Math.round(p * 0.75)));
  if (!result.ok) return { ok: false };
  const product = closestProduct(result.row.material, productList);
  const material = product ? String(product.name).toUpperCase() : result.row.material;
  return { ok: true, rows: [{ ...result.row, material, notes: result.notes }], unread: 0 };
}
