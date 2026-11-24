import { describe, expect, it } from 'vitest';
import { MAX_RECEIPT_PDF_BYTES, MAX_RECEIPT_PHOTO_BYTES, isImageFile, isPdfFile, receiptFileProblem } from './receiptFile';

const file = (name: string, type: string, size = 1000) => ({ name, type, size });

describe('receiptFileProblem', () => {
  it('accepts photos and PDFs', () => {
    expect(receiptFileProblem(file('a.jpg', 'image/jpeg'))).toBe('');
    expect(receiptFileProblem(file('a.heic', 'image/heic'))).toBe('');
    expect(receiptFileProblem(file('a.pdf', 'application/pdf'))).toBe('');
  });
  it('reads the extension when the browser gives no type', () => {
    expect(isPdfFile(file('Costco.PDF', ''))).toBe(true);
    expect(isImageFile(file('IMG_1.HEIC', ''))).toBe(true);
    expect(receiptFileProblem(file('IMG_1.HEIC', ''))).toBe('');
  });
  it('turns away other files and says what they are', () => {
    const msg = receiptFileProblem(file('Statement.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
    expect(msg).toContain('Statement.docx is a DOCX file');
    expect(msg).toContain('25 MB');
  });
  it('turns away a file that is too big or empty', () => {
    expect(receiptFileProblem(file('big.jpg', 'image/jpeg', MAX_RECEIPT_PHOTO_BYTES + 1))).toContain('over 25 MB');
    expect(receiptFileProblem(file('big.pdf', 'application/pdf', MAX_RECEIPT_PDF_BYTES + 1))).toContain('over 20 MB');
    // A photo may be bigger than a PDF is allowed to be: the browser shrinks it, a PDF goes up as it is.
    expect(receiptFileProblem(file('ok.jpg', 'image/jpeg', MAX_RECEIPT_PDF_BYTES + 1))).toBe('');
    expect(receiptFileProblem(file('ok.pdf', 'application/pdf', MAX_RECEIPT_PDF_BYTES))).toBe('');
    expect(receiptFileProblem(file('none.jpg', 'image/jpeg', 0))).toContain('empty');
  });
});
