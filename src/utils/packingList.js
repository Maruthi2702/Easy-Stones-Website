/**
 * Naming for the two PDFs attached to a delivery.
 *
 * Files are named after the packing list number so a downloads folder reads
 * clearly and sorts next to the paperwork:
 *
 *   packing list   → 145994.pdf
 *   signed copy    → 145994_signed.pdf
 *
 * The number is carried in the uploaded filename ("Packing List - #145994.pdf"),
 * which is the only place it reliably appears — a delivery can have a packing
 * list and no SO number at all.
 *
 * Shared by the client and server.js so the name on disk and the name in the
 * UI can't drift apart.
 */

/**
 * Pull the packing list number out of whatever we know about a delivery.
 * Falls back through SO number, invoice number, then the delivery id, so this
 * always returns something usable for a filename.
 */
export function packingListNumber(delivery = {}) {
  const fromFilename = String(delivery.packingListFilename || '');

  // "Packing List - #145994.pdf" → 145994. Also catches "PL 145994.pdf" and
  // "signed_packing_list_145656.pdf" from older uploads.
  const hashed = fromFilename.match(/#\s*(\d{3,})/);
  if (hashed) return hashed[1];

  const anyRun = fromFilename.replace(/\.[a-z0-9]+$/i, '').match(/(\d{3,})(?!.*\d{3,})/);
  if (anyRun) return anyRun[1];

  const so = String(delivery.soNumber || '').trim();
  if (so) return so;

  const inv = String(delivery.invoiceNumber || '').trim();
  if (inv) return inv;

  return String(delivery.id || 'packing_list');
}

/** Strip anything a filesystem or Content-Disposition header would object to. */
export function safeFileSegment(value) {
  return String(value || '')
    .replace(/[^\w.-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_|_$/g, '') || 'packing_list';
}

/** e.g. 145994.pdf */
export function packingListFileName(delivery = {}) {
  return `${safeFileSegment(packingListNumber(delivery))}.pdf`;
}

/** e.g. 145994_signed.pdf */
export function signedPackingListFileName(delivery = {}) {
  return `${safeFileSegment(packingListNumber(delivery))}_signed.pdf`;
}

/**
 * A cross-origin <a download="..."> is ignored by every browser — the file is
 * saved under whatever the URL ends with, which is why signed PDFs were landing
 * as "tmp_1786237545769_7441". Cloudinary can set the Content-Disposition for
 * us via fl_attachment, so ask it to.
 *
 * Same-origin URLs are returned untouched; the download attribute works there.
 */
export function downloadUrlFor(url, filename) {
  const href = String(url || '');
  if (!href.includes('res.cloudinary.com')) return href;

  // The extension has to come off: a dot inside fl_attachment is read as a
  // format specifier and Cloudinary answers `Content-Disposition: inline`
  // instead of attaching anything. Verified against the live asset.
  const name = safeFileSegment(String(filename || '').replace(/\.pdf$/i, ''));

  // Insert the flag as its own transformation segment, right after /upload/.
  return href.replace(/\/upload\/(?!fl_attachment)/, `/upload/fl_attachment:${name}/`);
}

/**
 * Save a PDF under an exact name, extension included.
 *
 * Neither of the simpler routes gets there on its own: a cross-origin
 * <a download> is ignored outright, and fl_attachment can't carry ".pdf".
 * Fetching the bytes and handing the browser a blob sidesteps both — the
 * storage host allows it (Access-Control-Allow-Origin: *).
 *
 * Falls back to the fl_attachment URL if the fetch is blocked, which still
 * beats the raw asset name.
 */
/**
 * Open a stored PDF in the browser's own viewer instead of saving it.
 *
 * A plain link cannot do this. These are stored on Cloudinary as raw assets,
 * and raw delivery answers `Content-Type: application/octet-stream` with
 * `Content-Disposition: attachment`, so every browser downloads it however the
 * link is written — target="_blank" included. Transformations that would
 * change either header (fl_inline, fl_attachment with an extension) are
 * rejected on raw assets with a 400, so the URL cannot be talked round either.
 *
 * Fetching the same bytes and re-wrapping them as application/pdf is what
 * leaves. The storage host allows the read (Access-Control-Allow-Origin: *),
 * which is the same route downloadPdf already takes.
 */
export async function openPdfInline(url) {
  const href = String(url || '');
  if (!href) return;

  // Opened synchronously, before the first await: a tab opened afterwards is a
  // popup as far as the browser is concerned, and gets blocked. Deliberately
  // without 'noopener', which would make window.open return null and leave
  // nothing to navigate — the handle is dropped by hand instead.
  const tab = window.open('', '_blank');
  if (tab) tab.opener = null;

  try {
    const res = await fetch(href);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = new Blob([await res.blob()], { type: 'application/pdf' });
    const objectUrl = URL.createObjectURL(blob);

    if (tab) tab.location.href = objectUrl;
    else window.open(objectUrl, '_blank');

    // Long enough that the viewer has the document, and that a reload inside
    // that tab still works for a while.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 5 * 60 * 1000);
  } catch (err) {
    console.warn('[packingList] inline preview failed, opening the file itself:', err);
    // Downloads rather than previews, but that beats a tab that does nothing.
    if (tab) tab.location.href = href;
    else window.open(href, '_blank', 'noopener');
  }
}

export async function downloadPdf(url, filename) {
  const href = String(url || '');
  if (!href) return;

  try {
    const res = await fetch(href);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();

    // Give the download a moment to start before dropping the blob.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
  } catch (err) {
    console.warn('[packingList] blob download failed, falling back:', err);
    window.open(downloadUrlFor(href, filename), '_blank', 'noopener');
  }
}
