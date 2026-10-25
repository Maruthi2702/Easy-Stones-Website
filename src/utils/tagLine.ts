/**
 * The Selection Sheet's tag scan, after the reading: what one printed tag
 * line says, what all the tags in one photo say together, and which sheet
 * rows they fill. Pure — tested in tagLine.test.js. The photo work (barcodes,
 * cutting out each tag's line, OCR) is selectionSheet/readTagPhoto.js.
 *
 * Every Easy Stones slab tag has a barcode with one printed line beside it:
 *   13583 - 51 / (8/13583) / 1265 / 137x79 / Mystique SJ MQ 3CM
 *   lot  - slab / (n/lot)  / (other) / size / material
 * (older tags have no "other" field). The lot is printed twice, which is the
 * check: both copies — and the other tags in the photo — have to agree.
 */
import { matchProduct, fuzzyMatchProduct, levenshtein } from './stoneLabel';
import type { Loose } from '../types/records';

/** What one printed tag line says ('' for a field it couldn't find). */
export type TagLine = { lot: string; slab: string; lotCopy: string; size: string; material: string };
/** A Selection Sheet row a scan fills. */
export type ScannedRow = { material: string; lot: string; details: string; size: string; notes: string[] };

// Letters OCR reads where a tag has digits; only fixed inside a token that
// already has a digit ("I265", "1358B"), never in a word.
const LOOKALIKE: Record<string, string> = { O: '0', o: '0', Q: '0', D: '0', I: '1', l: '1', i: '1', L: '1', S: '5', s: '5', B: '8', Z: '2', z: '2', G: '6', T: '7' };
const fixDigits = (token: string): string => token.replace(/[OoQDIliLSsBZzGT]/g, (c) => LOOKALIKE[c]);
// A material word that happens to contain a digit ("3CM", "2CM") stays as is.
const isThickness = (token: string): boolean => /^\dCM$/i.test(token);

const SIZE = /(?<!\d)(\d{2,3}(?:\.\d{1,2})?)\s*[xX×*]\s*(\d{2,3}(?:\.\d{1,2})?)(?![\d.])/;
// A slab side, in inches or cm: "137x791" is a misread, not a size.
const realSide = (n: string): boolean => Number(n) >= 20 && Number(n) <= 400;

/** What one tag's printed line says. Fields it couldn't find are ''. */
export function parseTagLine(text: unknown): TagLine {
  const line = String(text || '').replace(/\s+/g, ' ').trim()
    .replace(/[A-Za-z0-9]+/g, (t) => (/\d/.test(t) && !isThickness(t) && !/^\d+[xX]\d+$/.test(t) ? fixDigits(t) : t));

  const head = line.match(/(\d{4,6})\s*-\s*(\d{1,3})(?!\d)/);
  const copy = line.match(/\(\s*\d{1,3}\s*\/\s*(\d{4,6})/) || line.match(/\d{1,3}\s*\/\s*(\d{4,6})\s*\)/);
  const size = line.match(SIZE);

  let material = '';
  if (size) {
    const words = line.slice((size.index as number) + size[0].length)
      .replace(/^[\s/|\\]+/, '')
      .replace(/[^A-Za-z0-9 .\-&']/g, ' ')
      .split(' ').filter(Boolean);
    // Edge noise at the end of the strip: a stray letter or two.
    while (words.length > 1 && words[words.length - 1].length < 2) words.pop();
    material = words.join(' ').toUpperCase();
  }
  return {
    lot: head ? head[1] : '',
    slab: head ? String(Number(head[2])) : '',
    lotCopy: copy ? copy[1] : '',
    size: size && realSide(size[1]) && realSide(size[2]) ? `${size[1]}x${size[2]}` : '',
    material,
  };
}

const plainName = (s: unknown): string => String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

/**
 * The catalog product a misread material name is closest to, letter by
 * letter over the whole name ("ENJGMA SJ MABCM" → Enigma SJ MQ 3CM): at most
 * 30% different, and clearly closer than any other product.
 */
export function closestProduct(text: unknown, productList: Loose[] = []): Loose | null {
  const read = plainName(text);
  if (read.length < 5) return null;
  const ranked = productList
    .map((p) => ({ p, name: plainName(p?.name) }))
    .filter((x) => x.name.length >= 5)
    .map((x) => ({ ...x, d: levenshtein(read, x.name) }))
    .sort((a, b) => a.d - b.d);
  const [best, next] = ranked;
  if (!best || best.d > 0.3 * best.name.length) return null;
  if (next && next.d - best.d < 2) return null;
  return best.p;
}

/** The most common non-empty value (first seen wins a tie), with its count. */
function mostCommon(values: string[]): { value: string; count: number } {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) || 0) + 1);
  let best = ''; let n = 0;
  for (const [v, c] of counts) if (c > n) { best = v; n = c; }
  return { value: best, count: n };
}

/**
 * All the tags read from one photo, combined into sheet rows: one row per
 * lot, its slabs together ("51, 52, 53"). Each tag was read a few ways
 * (`texts`); a field is what most of the reads say. A tag counts only when
 * it gave a lot and a slab.
 *
 * @param {{ texts: string[] }[]} tags
 * @param {object[]} productList  the catalog, for the material's exact name
 * @returns {{ rows: {material, lot, details, size, notes: string[]}[], unread: number }}
 */
export function combineTagReads(tags: { texts?: string[] }[], productList: Loose[] = []): { rows: ScannedRow[]; unread: number } {
  const parsed = tags.map((t) => (t.texts || []).map(parseTagLine));
  // Every lot number seen anywhere in the photo, both printed copies.
  const photoLots = mostCommon(parsed.flat().flatMap((p) => [p.lot, p.lotCopy]));

  const read: { lot: string; slab: string; agreed: boolean; size: string; material: string }[] = [];
  let unread = 0;
  for (const reads of parsed) {
    const copies = reads.flatMap((p) => [p.lot, p.lotCopy]);
    // This tag's own reads decide; the rest of the photo breaks a tie.
    const score = (l: string) => copies.filter((x) => x === l).length * 10 + (l === photoLots.value ? 1 : 0);
    const lot = [...new Set(copies.filter(Boolean))].sort((a, b) => score(b) - score(a))[0] || '';
    const slab = mostCommon(reads.map((p) => p.slab)).value;
    if (!lot || !slab) { unread++; continue; }
    const materials = reads.map((p) => p.material).filter(Boolean);
    // The catalog's exact name, even when OCR slipped a letter or two.
    const product = materials.map((m) => matchProduct(m, productList) || fuzzyMatchProduct([m], productList) || closestProduct(m, productList)).find(Boolean) || null;
    read.push({
      lot,
      slab,
      agreed: reads.some((p) => p.lot === lot && p.lotCopy === lot),
      size: mostCommon(reads.map((p) => p.size)).value,
      material: product ? String(product.name).toUpperCase() : mostCommon(materials).value,
    });
  }

  const byLot = new Map<string, typeof read>();
  for (const tag of read) {
    if (!byLot.has(tag.lot)) byLot.set(tag.lot, []);
    byLot.get(tag.lot)!.push(tag);
  }
  const rows = [...byLot.entries()].map(([lot, group]) => {
    const slabs = [...new Set(group.map((g) => g.slab))].sort((a, b) => Number(a) - Number(b));
    const notes: string[] = [];
    // Sure when a tag's two printed copies agreed, or two tags carry the same lot.
    if (!group.some((g) => g.agreed) && group.length < 2) notes.push(`Check the lot (${lot}) — the tag's two lot numbers didn't match.`);
    return {
      material: mostCommon(group.map((g) => g.material)).value,
      lot,
      details: slabs.join(', '),
      size: mostCommon(group.map((g) => g.size)).value,
      notes,
    };
  });
  return { rows, unread };
}

const isEmptyRow = (row: Loose | null | undefined): boolean => ['material', 'lot', 'details', 'size', 'price'].every((k) => !String(row?.[k] || '').trim());

/**
 * Where scanned rows go: the first into the row whose scan button was
 * pressed (only the fields the tag gave — a typed price stays), the rest into
 * the next empty rows, then new rows up to `maxRows`.
 * @returns {{ rows: object[], filled: number[], dropped: number }}
 */
export function placeTagRows(sheetRows: Loose[], startIdx: number, scanned: Partial<ScannedRow>[], maxRows: number, emptyRow: () => Loose): { rows: Loose[]; filled: number[]; dropped: number } {
  const rows = sheetRows.map((r) => ({ ...r }));
  const filled: number[] = [];
  let dropped = 0;
  const fields = ({ material, lot, details, size }: Partial<ScannedRow>) => Object.fromEntries(
    Object.entries({ material, lot, details, size }).filter(([, v]) => String(v || '').trim()),
  );
  scanned.forEach((s, n) => {
    let at = n === 0 ? startIdx : rows.findIndex((r, i) => i > startIdx && !filled.includes(i) && isEmptyRow(r));
    if (at < 0) {
      if (rows.length >= maxRows) { dropped++; return; }
      rows.push(emptyRow());
      at = rows.length - 1;
    }
    rows[at] = { ...rows[at], ...fields(s) };
    filled.push(at);
  });
  return { rows, filled, dropped };
}
