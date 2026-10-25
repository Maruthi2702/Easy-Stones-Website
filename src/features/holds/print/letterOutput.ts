import type { RefObject } from 'react';

/*
 * Printing and saving the letter (moved out of HoldPrintPreview, 2026-10-24).
 */

// Safari (and every iPhone/iPad browser) can't print a PDF from inside the
// page; it opens in its own tab there, where Print / Share does the rest.
const printsInTab = () => {
  const ua = navigator.userAgent;
  const iOS = /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const safari = /Safari/.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|Edg/.test(ua);
  return iOS || safari;
};

/**
 * Print the PDF: from a hidden frame where the browser can, or in its own tab
 * (Safari, iPhone/iPad). `frameRef` keeps the frame so the next print (or
 * closing the preview) removes it.
 */
export function printPdf(blob: Blob, frameRef: RefObject<HTMLIFrameElement | null>) {
  const url = URL.createObjectURL(blob);
  setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
  if (printsInTab()) {
    window.open(url, '_blank');
    return;
  }
  frameRef.current?.remove();
  const frame = document.createElement('iframe');
  frame.className = 'hp-print-frame';
  frame.title = 'Print';
  frame.src = url;
  frame.onload = () => {
    try { frame.contentWindow!.focus(); frame.contentWindow!.print(); } catch { window.open(url, '_blank'); }
  };
  document.body.appendChild(frame);
  frameRef.current = frame;
}

/** Save the PDF as `fileName`. */
export function downloadPdf(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
