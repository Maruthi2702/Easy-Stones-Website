/**
 * Which files can be a card receipt (Add receipt → Upload Photo / Upload File):
 * a photo or a PDF, up to 10 MB. Shared by the choice window and the form, so a
 * wrong file is turned away before anything uploads.
 */
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

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
    return `${kind}. A receipt can be a photo (JPG, PNG, HEIC) or a PDF, up to 10 MB.`;
  }
  if (f.size > MAX_RECEIPT_BYTES) return `${f.name || 'This file'} is over 10 MB. Choose a smaller photo or PDF.`;
  if (f.size === 0) return `${f.name || 'This file'} is empty. Choose another file.`;
  return '';
}
