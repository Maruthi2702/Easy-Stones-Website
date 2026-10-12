/**
 * Browser-only image helpers for the Selection Sheet's tag scanner: load a
 * photo, draw it turned and cut, read its grey pixels. The maths — tilt,
 * barcode, text band — is src/utils/tagPhoto.js; what the tag says is
 * src/utils/tagLine.js and src/utils/stoneLabel.js.
 */
import { estimateSkew, levelBy, rotatedSize, findTagBox } from '../../../utils/tagPhoto';

// Longest side the tilt and barcode-like area are measured at: enough to see
// tag text and bars, small enough to stay quick on a phone.
const MEASURE_DIM = 800;
// A canvas bigger than this fails silently on iOS (16.7M px); stay under it.
const MAX_CANVAS_PX = 12_000_000;
const WHITE = '#ffffff';
const FULL_BOX = Object.freeze({ x: 0, y: 0, width: 100, height: 100 });

/** The photo as an <img>, turned upright by the browser from its camera orientation. */
export function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (err) => { URL.revokeObjectURL(url); reject(err); };
    img.src = url;
  });
}

export const toBlob = (canvas, quality = 0.92) => new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));

export const newCanvas = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = WHITE; // corners white like the tag, not black edges for OCR to read
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, ctx };
};

/**
 * Draws `img` scaled by `scale` and turned by `degrees` around its centre,
 * onto a white canvas big enough for the corners — or, with `box` (percent of
 * that turned picture), just that part of it.
 */
export function drawTurned(img, { degrees = 0, scale = 1, box = FULL_BOX } = {}) {
  const w = img.width * scale;
  const h = img.height * scale;
  const turned = rotatedSize(w, h, degrees);
  const left = (box.x / 100) * turned.width;
  const top = (box.y / 100) * turned.height;
  const { canvas, ctx } = newCanvas((box.width / 100) * turned.width, (box.height / 100) * turned.height);
  ctx.translate(turned.width / 2 - left, turned.height / 2 - top);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  return canvas;
}

export function greyPixels(canvas) {
  const { width, height } = canvas;
  const { data } = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height);
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) gray[i] = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
  return gray;
}

export const fitScale = (w, h, max) => Math.min(1, max / Math.max(w, h));

/**
 * For a photo whose barcode couldn't be read: how far to turn it to level
 * the tag, and the area around anything barcode-like (else the whole photo),
 * cut from the full-resolution photo for the OCR fallback.
 */
export async function levelledTagArea(img) {
  const small = drawTurned(img, { scale: fitScale(img.width, img.height, MEASURE_DIM) });
  const turn = -levelBy(estimateSkew(greyPixels(small), small.width, small.height).angle);
  const turnedSize = rotatedSize(img.width, img.height, turn);
  const measure = drawTurned(img, { degrees: turn, scale: fitScale(turnedSize.width, turnedSize.height, MEASURE_DIM) });
  const box = findTagBox(greyPixels(measure), measure.width, measure.height) || FULL_BOX;
  const area = turnedSize.width * (box.width / 100) * turnedSize.height * (box.height / 100);
  const scale = Math.min(1, Math.sqrt(MAX_CANVAS_PX / Math.max(1, area)));
  return toBlob(drawTurned(img, { degrees: turn, scale, box }), 0.95);
}

// OCR pass size: a big crop is shrunk to this for speed and phone memory; a
// small one (a tag shot from a distance) is enlarged toward it, up to 2× —
// Tesseract misses small text it reads fine enlarged.
const OCR_DIM = 1600;
const MAX_UPSCALE = 2;

/** One OCR pass's image, sized for Tesseract and turned by `degrees`. */
export async function preprocessImage(file, degrees = 0) {
  const img = await loadImage(file);
  const scale = Math.min(MAX_UPSCALE, OCR_DIM / Math.max(img.width, img.height));
  return toBlob(drawTurned(img, { degrees, scale }), 0.9);
}
