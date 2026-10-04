/**
 * Slab-tag scanning for the Selection Sheet: turns the raw text Tesseract
 * reads off a photographed slab tag into the sheet's Material / Lot / Slab
 * Numbers / Size fields. Pure functions only — the OCR itself (and the
 * rotation passes) run in CheckInLogPanel's executeTagOcrScan.
 *
 * A tag reads like "13845 - 7 (7/13845) 126 x 63 CALACATTA GOLD" — lot,
 * slab number, (slab/lot bundle), size, material — on one line or several.
 *
 * Two rules this module exists to keep:
 *  - A read that doesn't look like a tag is rejected (null), never "best
 *    guessed". Tags on standing slabs are photographed sideways, and the
 *    upright OCR pass of a sideways tag is garbage; the old parser accepted
 *    that garbage, so the rotation loop stopped on it and junk was typed in.
 *  - A lot number is only changed to match stock when the match is
 *    unambiguous, and the change is reported back so the person checks it.
 */

// The rotations a scan tries, in order. 0° first because most tags are shot
// upright; a confident, complete read there ends the scan early.
export const ORIENTATIONS = [0, 90, 270, 180];

// Letters Tesseract commonly reads where a tag has digits. Only applied to a
// token that already contains a digit ("1384S", "7O") — never to a plain
// word, or "lot" / "TO" / "IS" turn into 107 / 70 / 15.
const DIGIT_LOOKALIKES = { O: '0', o: '0', I: '1', l: '1', i: '1', '|': '1', S: '5', s: '5', B: '8', G: '6', Z: '2', z: '2', T: '7' };

const LABEL_WORDS = new Set(['LOT', 'SLAB', 'SLABS', 'BUNDLE', 'BUNDLES', 'SIZE', 'BLK', 'BLOCK', 'NO', 'NUM', 'NUMBER', 'QTY']);

const toDigits = (token) => {
  if (!/\d/.test(token)) return null;
  const mapped = token.replace(/[OoIliSsBGZzT|]/g, (c) => DIGIT_LOOKALIKES[c]);
  return /^\d+$/.test(mapped) ? mapped : null;
};

const normalizeName = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const normalizeLot = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const normalizeSize = (s) => String(s || '').toLowerCase().replace(/["”″“']|in\b|\s+/g, '').replace(/[×*%]/g, 'x');

export const levenshtein = (a, b) => {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? diag : 1 + Math.min(diag, prev[j], prev[j - 1]);
      diag = up;
    }
  }
  return prev[b.length];
};

// Inch marks / "in" after either number are allowed and dropped: 126" x 63".
const INCH = `(?:["”″“']{1,2}|in\\.?)?`;
const SIZE_RE = new RegExp(`(^|[^\\d.])(\\d{2,4}(?:\\.\\d{1,2})?)\\s*${INCH}\\s*[xX×*%]\\s*(\\d{2,4}(?:\\.\\d{1,2})?)(?![\\d.])\\s*${INCH}`);
const THICKNESS_RE = /\b\d+(?:\.\d+)?\s*(?:cm|mm)\b/gi;
const BUNDLE_RE = /[([{]\s*([^)\]}\n]{1,24}?)\s*[)\]}]/;
const LABELED_LOT_RE = /\b(?:lot|bundle|blk|block)\b\s*(?:#|no\.?|num(?:ber)?)?\s*[:.#-]?\s*([A-Z]{0,3}\d[A-Z0-9-]*)/i;
const LABELED_SLAB_RE = /\bslabs?\b\s*(?:#|no\.?|num(?:ber)?)?\s*[:.#-]?\s*(\d{1,4})(?!\d)/i;
// "13845 - 7": a lot of 3+ characters, a dash, then a 1–3 digit slab number.
const LOT_SLAB_RE = /(^|[^\w/])([A-Z]{0,3}\d{3,}[A-Z]?)\s*[-–—]\s*(\d{1,3})(?![\d/])/i;

/**
 * Catalog product named by `name` — an exact name, or the longest catalog name
 * that appears in it as whole words (so "ICE WHITE 3CM" is "Ice White", not
 * "Ice"). Never matches on an empty name.
 */
export const matchProduct = (name, productList = []) => {
  const text = normalizeName(name);
  if (!text) return null;
  let best = null;
  for (const p of productList) {
    const pn = normalizeName(p?.name);
    if (!pn) continue;
    if (pn === text) return p;
    if (` ${text} `.includes(` ${pn} `) && (!best || pn.length > normalizeName(best.name).length)) best = p;
  }
  return best;
};

// Catalog product whose name OCR read with a typo or two ("CALACATA G0LD").
const fuzzyMatchProduct = (lines, productList) => {
  let best = null;
  for (const line of lines) {
    const words = normalizeName(line).split(' ').filter(Boolean);
    for (const p of productList) {
      const pn = normalizeName(p?.name);
      if (pn.length < 5) continue; // too short to fuzzy-match safely
      const n = pn.split(' ').length;
      for (let i = 0; i + n <= words.length; i++) {
        const d = levenshtein(words.slice(i, i + n).join(' '), pn);
        if (d <= Math.floor(pn.length / 6) && (!best || d < best.d)) best = { p, d };
      }
    }
  }
  return best?.p || null;
};

// Free-text material when the catalog doesn't have it: the most letter-heavy
// line that reads like words — at least one 4+ letter word, mostly letters.
const freeTextMaterial = (lines) => {
  let best = '';
  let bestLetters = 0;
  for (const line of lines) {
    const words = line.split(/\s+/)
      .map((w) => w.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, ''))
      .filter((w) => w && !/\d/.test(w) && !LABEL_WORDS.has(w.toUpperCase()));
    const candidate = words.join(' ');
    const letters = (candidate.match(/[A-Za-z]/g) || []).length;
    const nonSpace = candidate.replace(/\s/g, '').length;
    if (!words.some((w) => /^[A-Za-z]{4,}$/.test(w))) continue;
    if (letters / nonSpace < 0.75) continue;
    if (letters > bestLetters) { best = candidate; bestLetters = letters; }
  }
  return best;
};

/**
 * Read a tag's fields out of OCR text. Returns null unless the text looks like
 * a tag: a catalog material, or at least two of lot / size / material.
 *
 * @returns {{ lot, slab, size, material, product, bundleLot } | null}
 */
export const readStoneLabel = (text, productList = []) => {
  if (!text || !text.trim()) return null;

  // Fix digit look-alikes token by token ("1384S" → "13845"), leaving words alone.
  let work = text.replace(/[A-Za-z0-9|]+/g, (t) => toDigits(t) ?? t);

  let size = '';
  const sizeMatch = work.match(SIZE_RE);
  if (sizeMatch) {
    size = `${sizeMatch[2]} x ${sizeMatch[3]}`;
    work = work.replace(sizeMatch[0], `${sizeMatch[1]} `);
  }
  work = work.replace(THICKNESS_RE, ' ');

  let bundleRaw = '';
  const bundleMatch = work.match(BUNDLE_RE);
  if (bundleMatch) {
    bundleRaw = bundleMatch[1].trim();
    work = work.replace(bundleMatch[0], ' ');
  }

  let lot = '';
  let slab = '';
  const labeledLot = work.match(LABELED_LOT_RE);
  if (labeledLot) lot = labeledLot[1];
  const labeledSlab = work.match(LABELED_SLAB_RE);
  if (labeledSlab) slab = labeledSlab[1];
  if (!lot) {
    const pair = work.match(LOT_SLAB_RE);
    if (pair) {
      lot = pair[2];
      if (!slab) slab = pair[3];
    }
  }
  if (!lot) {
    // Unlabeled numbers: the first 4+ digit one is the lot, the next short one
    // the slab. 4, not 3 — a wrong-rotation read is full of stray 3-digit runs.
    const tokens = work.match(/[A-Za-z]{0,3}\d[A-Za-z0-9]*/g) || [];
    const lotIdx = tokens.findIndex((t) => (t.match(/\d/g) || []).length >= 4);
    if (lotIdx >= 0) {
      lot = tokens[lotIdx];
      if (!slab) slab = tokens.slice(lotIdx + 1).find((t) => /^\d{1,3}$/.test(t)) || '';
    }
  }

  // The bundle is "(slab/lot)". OCR often reads its "/" as "1" ("7113845"),
  // so with a known lot the slab is whatever is left in front of it.
  let bundleLot = '';
  if (bundleRaw) {
    const parts = bundleRaw.split(/\s*[/\\]\s*/).filter(Boolean);
    let bundleSlab = '';
    if (parts.length === 2 && /^\d{1,3}$/.test(parts[0]) && /\d{3,}/.test(parts[1])) {
      [bundleSlab, bundleLot] = parts;
    } else if (lot && /^\d+$/.test(bundleRaw) && bundleRaw.length > lot.length && bundleRaw.endsWith(lot)) {
      bundleSlab = bundleRaw.slice(0, -lot.length).replace(/1$/, '');
      bundleLot = lot;
    }
    if (!lot && bundleLot) lot = bundleLot;
    if (!slab && /^\d{1,3}$/.test(bundleSlab)) slab = bundleSlab;
  }

  // Material: the catalog first (exact words, then a close spelling), then free text.
  const lines = work.split('\n').map((l) => l.trim()).filter(Boolean);
  let product = matchProduct(lines.join(' '), productList);
  if (!product) {
    for (const line of lines) {
      product = matchProduct(line, productList);
      if (product) break;
    }
  }
  if (!product) product = fuzzyMatchProduct(lines, productList);
  const material = product ? String(product.name).toUpperCase() : freeTextMaterial(lines).toUpperCase();

  const found = [lot, size, material].filter(Boolean).length;
  if (!product && found < 2) return null;
  return { lot, slab, size, material, product, bundleLot };
};

/** How good one rotation's read is — the scan keeps the highest-scoring one. */
export const scoreLabelRead = (read, confidence = 0) => {
  if (!read) return -1;
  return confidence
    + (read.size ? 15 : 0)
    + (read.lot ? 10 : 0)
    + (read.slab ? 5 : 0)
    + (read.product ? 20 : read.material ? 5 : 0);
};

// Tesseract's mean word confidence below which a read with no catalog match is
// treated as noise. Wrong-rotation passes of a clean tag scored 40–51 in
// testing; the right rotation scored 85–91.
export const MIN_CONFIDENCE = 55;

/** Worth filling into the sheet at all. */
export const isUsableRead = (read, confidence = 0) =>
  Boolean(read && (read.product || confidence >= MIN_CONFIDENCE));

/** Good enough to stop trying other rotations. */
export const isConfidentRead = (read, confidence = 0) =>
  Boolean(read && confidence >= 70 && read.lot && read.size && read.material);

/**
 * Check a read against stock: the lot against the product's bundles, the size
 * against its sizes. Returns the sheet row's fields plus `notes` — one line
 * per thing the person should double-check.
 */
export const resolveLabelRead = (read, productList = []) => {
  const notes = [];
  const product = read.product || matchProduct(read.material, productList);

  let lot = read.lot;
  const stockLots = (product?.bundles || [])
    .flatMap((b) => [b?.bundleNumber, b?.serial])
    .filter(Boolean)
    .map(String);
  const readLots = [...new Set([read.lot, read.bundleLot].filter(Boolean))];
  if (stockLots.length && readLots.length) {
    const exact = readLots
      .map((l) => stockLots.find((s) => normalizeLot(s) === normalizeLot(l)))
      .find(Boolean);
    if (exact) {
      lot = exact;
    } else {
      // A single stock lot one character off is almost certainly an OCR slip;
      // two or more is a guess, so leave what was read.
      const near = [...new Set(stockLots.filter((s) => readLots.some((l) => {
        const a = normalizeLot(s);
        const b = normalizeLot(l);
        return a.length === b.length && a.length >= 4 && levenshtein(a, b) === 1;
      })))];
      if (near.length === 1) {
        notes.push(`Lot read as ${read.lot || read.bundleLot}, matched to stock lot ${near[0]}.`);
        lot = near[0];
      } else {
        notes.push(`Lot ${read.lot || read.bundleLot} isn't in stock for ${product.name}.`);
      }
    }
  } else if (read.bundleLot && read.lot && normalizeLot(read.bundleLot) !== normalizeLot(read.lot)) {
    notes.push(`Tag shows two lot numbers (${read.lot} and ${read.bundleLot}).`);
  }

  let size = read.size;
  const stockSizes = (product?.sizes || []).filter(Boolean);
  if (size && stockSizes.length) {
    const target = normalizeSize(size);
    const exact = stockSizes.find((s) => normalizeSize(s) === target);
    if (exact) {
      size = exact;
    } else {
      const near = stockSizes.filter((s) => levenshtein(normalizeSize(s), target) === 1);
      if (near.length === 1) {
        notes.push(`Size read as ${read.size}, matched to stock size ${near[0]}.`);
        size = near[0];
      }
    }
  }

  return { material: read.material, lot, details: read.slab, size, notes };
};
