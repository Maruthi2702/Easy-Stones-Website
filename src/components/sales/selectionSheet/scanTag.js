/**
 * Read a cropped slab-tag photo into a Selection Sheet row: OCR every
 * rotation with one Tesseract worker, keep the best read, check it against
 * stock. The text rules are src/utils/stoneLabel.js (tested there); this is
 * the browser half — image passes and the worker.
 */
import {
  ORIENTATIONS, readStoneLabel, resolveLabelRead, scoreLabelRead, isUsableRead, isConfidentRead,
} from '../../../utils/stoneLabel';
import { preprocessImage } from './tagImage';

/**
 * @param {Blob} croppedBlob  the area of the photo the person framed
 * @param {object[]} productList  the catalog (/api/products), for names, lots and sizes
 * @param {(percent: number) => void} [onProgress]
 * @returns {Promise<{ ok: true, row: {material, lot, details, size}, notes: string[] } | { ok: false, message: string }>}
 */
export async function scanTag(croppedBlob, productList = [], onProgress) {
  let worker = null;
  let pass = 0;
  try {
    const { createWorker } = await import('tesseract.js');
    // One worker for every rotation, not a fresh one (and download) per pass.
    worker = await createWorker('eng', undefined, {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          onProgress?.(Math.floor(((pass + m.progress) / ORIENTATIONS.length) * 100));
        }
      },
    });

    // Tags on standing slabs are usually photographed sideways, so every
    // rotation is tried and the best read kept; a confident, complete read
    // ends it early. readStoneLabel rejects garbage, so a wrong rotation
    // can't win just by coming first.
    let best = null;
    for (pass = 0; pass < ORIENTATIONS.length; pass++) {
      const processed = await preprocessImage(croppedBlob, ORIENTATIONS[pass]);
      const { data } = await worker.recognize(processed);
      const read = readStoneLabel(data.text, productList);
      const score = scoreLabelRead(read, data.confidence);
      if (!best || score > best.score) best = { read, score, confidence: data.confidence };
      if (isConfidentRead(read, data.confidence)) break;
    }

    if (!best || !isUsableRead(best.read, best.confidence)) {
      return { ok: false, message: "Couldn't read this tag. Try a closer, straight-on photo and fit the box around just the tag." };
    }
    const { material, lot, details, size, notes } = resolveLabelRead(best.read, productList);
    return { ok: true, row: { material, lot, details, size }, notes };
  } catch (err) {
    console.error('Tag scan failed:', err);
    return { ok: false, message: `Couldn't scan the tag: ${err.message}` };
  } finally {
    if (worker) worker.terminate().catch(() => {});
  }
}
