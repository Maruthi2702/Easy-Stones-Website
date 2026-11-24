// @vitest-environment jsdom
// ReceiptPreview: a photo is an <img>; a PDF is drawn in the same box (pdf.js) and, when the
// file can't be read, says so and offers a new tab instead of leaving a blank box.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import ReceiptPreview from './components/ReceiptPreview';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('ReceiptPreview', () => {
  it('shows a photo as an image and Back closes the viewer', () => {
    const onClose = vi.fn();
    const { container } = render(<ReceiptPreview url="/api/card-receipts/files/a.webp" variant="viewer" onClose={onClose} />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/api/card-receipts/files/a.webp');
    fireEvent.click(screen.getByRole('button', { name: /back to receipt/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('opens a PDF in the same box, not a new tab (no image, no link out while it loads)', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const { container } = render(<ReceiptPreview url="/api/card-receipts/files/a.pdf" variant="viewer" onClose={() => {}} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText(/opening the pdf/i)).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('says so, with a new-tab link, when the PDF cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('blocked'))));
    render(<ReceiptPreview url="https://cdn.example.com/r.pdf" variant="viewer" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    const link = screen.getByRole('link', { name: /new tab/i });
    expect(link.getAttribute('href')).toBe('https://cdn.example.com/r.pdf');
  });
});
