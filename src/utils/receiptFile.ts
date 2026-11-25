/**
 * Which files can be a card receipt (Add receipt → Upload Photo / Upload File):
 * a photo (up to 25 MB — the browser shrinks it before it is sent) or a PDF (up to 20 MB, sent as it is).
 * Shared by the choice window and the form, so a
 * wrong file is turned away before anything uploads.
 */
export const MAX_RECEIPT_PHOTO_BYTES = 25 * 1024 * 1024;
export const MAX_RECEIPT_PDF_BYTES = 20 * 1024 * 1024;

type FileLike = { name: string; type: string; size: number };

const extensionOf = (name: string) => (name.split('.').pop() || '').toLowerCase();
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'gif'];

export const isPdfFile = (f: Pick<FileLike, 'name' | 'type'>) => f.type === 'application/pdf' || (!f.type && extensionOf(f.name) === 'pdf');
export const isImageFile = (f: Pick<FileLike, 'name' | 'type'>) => f.type.startsWith('image/') || (!f.type && IMAGE_EXTENSIONS.includes(extensionOf(f.name)));

/** Why a file can't be used, in words for the person, or '' when it can. */
export function receiptFileProblem(f: FileLike): string {
  if (!isPdfFile(f) && !isImageFile(f)) {
    const ext = extensionOf(f.name);
    const kind = ext ? `${f.name} is a ${ext.toUpperCase()} file` : `${f.name || 'This file'} isn’t a photo or a PDF`;
    return `${kind}. A receipt can be a photo (JPG, PNG, HEIC) or a PDF (photos up to 25 MB, PDFs up to 20 MB).`;
  }
  if (isPdfFile(f) && f.size > MAX_RECEIPT_PDF_BYTES) return `${f.name || 'This file'} is over 20 MB. Take a photo of the receipt instead, or choose a smaller PDF.`;
  if (!isPdfFile(f) && f.size > MAX_RECEIPT_PHOTO_BYTES) return `${f.name || 'This file'} is over 25 MB. Choose a smaller photo.`;
  if (f.size === 0) return `${f.name || 'This file'} is empty. Choose another file.`;
  return '';
}

// ── The same photo twice (2026-11-24) ───────────────────────────────────────

/**
 * A receipt file's fingerprint: the SHA-256 of the file as picked (before the browser shrinks it), in hex. The
 * server keeps it on the stored file and on the expense, and warns when a new upload has one already on a receipt.
 */
export const isReceiptHash = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);

/** The receipt a just-uploaded photo is already on: its details when the uploader may see it, else only that it exists. */
export type PhotoDuplicate =
  | { seen: true; own: boolean; holderName: string; merchant: string; date: string; cents: number; status: string }
  | { seen: false };

const STATUS_WORDS: Record<string, string> = {
  missing: 'missing receipt', draft: 'draft', waiting: 'waiting for approval', sent_back: 'sent back', approved: 'approved'
};
const usDay = (day: string) => (/^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day.slice(5, 7)}-${day.slice(8, 10)}-${day.slice(0, 4)}` : day);
const money = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** What the form says about it: a warning only, the person may still save (two purchases can share a printout). */
export function duplicatePhotoLine(d: PhotoDuplicate | null | undefined): string {
  if (!d) return '';
  if (!d.seen) return 'This photo is already on another person’s receipt. Check it’s the right one.';
  const what = [d.merchant, money(d.cents), usDay(d.date)].filter(Boolean).join(', ');
  const whose = d.own ? 'your receipt' : `${d.holderName.split(' ')[0] || 'another person'}’s receipt`;
  return `This photo is already on ${whose} (${what}, ${STATUS_WORDS[d.status] || d.status}). Check it’s not the same receipt twice.`;
}
