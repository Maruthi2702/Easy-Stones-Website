import { describe, expect, it } from 'vitest';
import { MAX_RECEIPT_BYTES, isImageFile, isPdfFile, receiptFileProblem } from './receiptFile';

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
    expect(msg).toContain('10 MB');
  });
  it('turns away a file that is too big or empty', () => {
    expect(receiptFileProblem(file('big.jpg', 'image/jpeg', MAX_RECEIPT_BYTES + 1))).toContain('over 10 MB');
    expect(receiptFileProblem(file('none.jpg', 'image/jpeg', 0))).toContain('empty');
  });
});
