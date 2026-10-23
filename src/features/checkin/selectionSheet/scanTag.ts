/**
 * Read a cropped slab-tag photo into a Selection Sheet row: OCR every
 * rotation (two ways each) with one Tesseract worker, keep the best read, check it against
 * stock. The text rules are src/utils/stoneLabel.js (tested there); this is
 * the browser half — image passes and the worker.
 */
import {
  ORIENTATIONS, readStoneLabel, resolveLabelRead, scoreLabelRead, isUsableRead, isConfidentRead,
} from '../../../utils/stoneLabel';
import { preprocessImage } from './tagImage';
import type { Loose } from '../../../types/records';

// Tesseract page modes: 6 = one block of text, 3 = find the layout itself.
const PAGE_MODES = ['6', '3'];

/**
 * @param {Blob} croppedBlob  the area of the photo the person framed
 * @param {object[]} productList  the catalog (/api/products), for names, lots and sizes
 * @param {(percent: number) => void} [onProgress]
 * @returns {Promise<{ ok: true, row: {material, lot, details, size}, notes: string[] } | { ok: false, message: string }>}
 */
export type ScanResult = { ok: true; row: { material: string; lot: string; details: string; size: string }; notes: string[] } | { ok: false; message: string };

export async function scanTag(croppedBlob: Blob, productList: Loose[] = [], onProgress?: (percent: number) => void): Promise<ScanResult> {
  let worker: import('tesseract.js').Worker | null = null;
  let pass = 0;
  try {
    const { createWorker } = await import('tesseract.js');
    // One worker for every rotation, not a fresh one (and download) per pass.
    worker = await createWorker('eng', undefined, {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          onProgress?.(Math.floor(((pass + m.progress) / (ORIENTATIONS.length * PAGE_MODES.length)) * 100));
        }
      },
    });

    // Tags on standing slabs are usually photographed sideways, so every
    // rotation is tried and the best read kept; a confident, complete read
    // ends it early. readStoneLabel rejects garbage, so a wrong rotation
    // can't win just by coming first. (The photo was already turned level
    // and cut around the tag — levelledTagArea — so one of these four is upright.)
    // Each rotation is read as one block of text first (a tight tag crop),
    // then with Tesseract's own layout finding: on an angled tag the latter
    // found no text at all.
    let best: { read: ReturnType<typeof readStoneLabel>; score: number; confidence: number } | null = null;
    passes: for (let turn = 0; turn < ORIENTATIONS.length; turn++) {
      const processed = await preprocessImage(croppedBlob, ORIENTATIONS[turn]);
      for (const mode of PAGE_MODES) {
        await worker.setParameters({ tessedit_pageseg_mode: mode as import('tesseract.js').PSM });
        const { data } = await worker.recognize(processed as Blob);
        pass++;
        const read = readStoneLabel(data.text, productList);
        const score = scoreLabelRead(read, data.confidence);
        if (!best || score > best.score) best = { read, score, confidence: data.confidence };
        if (isConfidentRead(read, data.confidence)) break passes;
      }
    }

    if (!best || !isUsableRead(best.read, best.confidence)) {
      return { ok: false, message: "Couldn't read this tag. Try a closer photo and fit the box around just one tag." };
    }
    const { material, lot, details, size, notes } = resolveLabelRead(best.read!, productList);
    return { ok: true, row: { material, lot, details, size }, notes };
  } catch (err) {
    console.error('Tag scan failed:', err);
    return { ok: false, message: `Couldn't scan the tag: ${(err as Error).message}` };
  } finally {
    if (worker) worker.terminate().catch(() => {});
  }
}
