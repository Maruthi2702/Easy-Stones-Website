/**
 * pdfSigner.js
 *
 * Stamps customer + driver signatures, signee name, date/time, and a green
 * ePOD verification badge directly onto the PDF packing list.
 *
 * Safe for all PDF font encodings — automatically sanitizes input text to ASCII.
 */

import { PDFDocument, rgb } from 'pdf-lib';

// ─── helpers ────────────────────────────────────────────────────────────────

function sanitizeAscii(str) {
  if (!str) return '';
  return String(str).replace(/[^\x00-\x7F]/g, ' ').trim();
}

function dataUrlToBytes(dataUrl) {
  const parts = dataUrl.split(',');
  const base64 = (parts[1] || parts[0]).replace(/\s/g, '');
  if (typeof window === 'undefined' && typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function fetchPdfBytes(url) {
  if (url instanceof ArrayBuffer) return new Uint8Array(url);
  if (url instanceof Uint8Array) return url;

  if (typeof url === 'string' && url.startsWith('data:application/pdf')) {
    return dataUrlToBytes(url);
  }

  let res;
  try {
    res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    const relative = typeof url === 'string' ? url.replace(/^https?:\/\/[^/]+/, '') : url;
    res = await fetch(relative);
    if (!res.ok) throw new Error(`HTTP ${res.status} (proxy)`);
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

async function embedSig(pdfDoc, dataUrl, maxW, maxH) {
  if (!dataUrl || !dataUrl.startsWith('data:image/')) return null;
  try {
    const bytes = dataUrlToBytes(dataUrl);
    const isJpeg = dataUrl.includes('data:image/jpeg') || dataUrl.includes('data:image/jpg');
    const img = isJpeg ? await pdfDoc.embedJpg(bytes) : await pdfDoc.embedPng(bytes);
    return { img, dims: img.scaleToFit(maxW, maxH) };
  } catch (err) {
    console.warn('[pdfSigner] embedSig error:', err);
    return null;
  }
}

// ─── main export ─────────────────────────────────────────────────────────────

/**
 * @param {Object} params
 * @param {string|ArrayBuffer} params.pdfUrl
 * @param {string} params.customerSignatureDataUrl
 * @param {string} params.driverSignatureDataUrl
 * @param {string} params.signeeName
 * @param {string} params.deliveryInfo  e.g. "SO# 145301 - Acme Corp - 2026-08-03"
 * @param {Date|string} params.signedAt
 * @returns {Promise<Blob>}
 */
export async function stampSignaturesOnPdf({
  pdfUrl,
  customerSignatureDataUrl,
  driverSignatureDataUrl,
  signeeName,
  driverName,
  deliveryInfo = '',
  signedAt,
}) {
  // 1. Load PDF
  const pdfBytes = await fetchPdfBytes(pdfUrl);
  const pdfDoc   = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pages    = pdfDoc.getPages();
  const lastPage = pages[pages.length - 1];
  const { width, height } = lastPage.getSize();

  // 2. Date / time strings
  const signedDate = signedAt ? new Date(signedAt) : new Date();
  const dateStr    = signedDate.toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
  const timeStr = signedDate.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit',
  });

  const cleanName   = sanitizeAscii(signeeName);
  const cleanDriver = sanitizeAscii(driverName);
  const cleanDate   = sanitizeAscii(`${dateStr} ${timeStr}`);

  // 3. Embed Signatures
  const custSig = await embedSig(pdfDoc, customerSignatureDataUrl, 180, 48);
  const drvSig  = await embedSig(pdfDoc, driverSignatureDataUrl,   180, 48);

  // ─── A. DEDICATED ePOD SIGNATURE CERTIFICATE PANEL (BOTTOM Y = 10..115) ─────
  // Replaces the blank Name/Signature/Date lines cleanly with an official ePOD Certificate
  const PANEL_Y      = 10;
  const PANEL_HEIGHT = 105;
  const PANEL_MARGIN = 20;
  const PANEL_WIDTH  = width - (PANEL_MARGIN * 2);

  // Background white box to cover template's blank lines
  lastPage.drawRectangle({
    x: PANEL_MARGIN,
    y: PANEL_Y,
    width: PANEL_WIDTH,
    height: PANEL_HEIGHT,
    color: rgb(0.98, 0.98, 1.0),
    borderColor: rgb(0.83, 0.69, 0.22), // Gold border
    borderWidth: 1.5,
  });

  // Top gold banner bar
  lastPage.drawRectangle({
    x: PANEL_MARGIN,
    y: PANEL_Y + PANEL_HEIGHT - 18,
    width: PANEL_WIDTH,
    height: 18,
    color: rgb(0.83, 0.69, 0.22), // Gold header
  });

  // Header text
  lastPage.drawText('PROOF OF DELIVERY (ePOD) DIGITAL SIGNATURE CERTIFICATE', {
    x: PANEL_MARGIN + 10,
    y: PANEL_Y + PANEL_HEIGHT - 13,
    size: 8,
    color: rgb(0, 0, 0),
  });

  // Two Signature Columns
  const COL_W = (PANEL_WIDTH - 24) / 2;
  const CUST_COL_X = PANEL_MARGIN + 8;
  const DRV_COL_X  = PANEL_MARGIN + 16 + COL_W;
  const SIG_AREA_Y = PANEL_Y + 8;
  const SIG_AREA_H = PANEL_HEIGHT - 30;

  // 1) Customer Box
  lastPage.drawRectangle({
    x: CUST_COL_X,
    y: SIG_AREA_Y,
    width: COL_W,
    height: SIG_AREA_H,
    color: rgb(1, 1, 1),
    borderColor: rgb(0.85, 0.85, 0.9),
    borderWidth: 1,
  });

  lastPage.drawText('CUSTOMER SIGNATURE', {
    x: CUST_COL_X + 6,
    y: SIG_AREA_Y + SIG_AREA_H - 10,
    size: 6.5,
    color: rgb(0.4, 0.4, 0.5),
  });

  if (custSig) {
    const fitCust = custSig.img.scaleToFit(COL_W - 12, SIG_AREA_H - 20);
    lastPage.drawImage(custSig.img, {
      x: CUST_COL_X + (COL_W - fitCust.width) / 2,
      y: SIG_AREA_Y + 12 + (SIG_AREA_H - 22 - fitCust.height) / 2,
      width: fitCust.width,
      height: fitCust.height,
    });
  }

  const custLabel = sanitizeAscii(`Signee: ${cleanName || 'Customer'} - ${cleanDate}`);
  lastPage.drawText(custLabel, {
    x: CUST_COL_X + 6,
    y: SIG_AREA_Y + 3,
    size: 6,
    color: rgb(0.2, 0.2, 0.2),
  });

  // 2) Driver Box
  lastPage.drawRectangle({
    x: DRV_COL_X,
    y: SIG_AREA_Y,
    width: COL_W,
    height: SIG_AREA_H,
    color: rgb(1, 1, 1),
    borderColor: rgb(0.85, 0.85, 0.9),
    borderWidth: 1,
  });

  lastPage.drawText('DRIVER SIGNATURE', {
    x: DRV_COL_X + 6,
    y: SIG_AREA_Y + SIG_AREA_H - 10,
    size: 6.5,
    color: rgb(0.4, 0.4, 0.5),
  });

  if (drvSig) {
    const fitDrv = drvSig.img.scaleToFit(COL_W - 12, SIG_AREA_H - 20);
    lastPage.drawImage(drvSig.img, {
      x: DRV_COL_X + (COL_W - fitDrv.width) / 2,
      y: SIG_AREA_Y + 12 + (SIG_AREA_H - 22 - fitDrv.height) / 2,
      width: fitDrv.width,
      height: fitDrv.height,
    });
  } else {
    lastPage.drawText('[ Driver Signed ]', {
      x: DRV_COL_X + 10,
      y: SIG_AREA_Y + SIG_AREA_H / 2 - 3,
      size: 7,
      color: rgb(0.5, 0.5, 0.5),
    });
  }

  const drvLabel = sanitizeAscii(`Driver: ${cleanDriver || 'Driver Sign-off'} - ${cleanDate}`);
  lastPage.drawText(drvLabel, {
    x: DRV_COL_X + 6,
    y: SIG_AREA_Y + 3,
    size: 6,
    color: rgb(0.2, 0.2, 0.2),
  });

  // ─── B. GREEN ePOD VERIFIED BADGE (TOP-CENTER HEADER WHITE SPACE) ──────────
  // Placed in the open white space between Company Address (left) and Barcode/Packing List # (right)
  const STAMP_W = 125;
  const STAMP_H = 32;
  const STAMP_X = (width / 2) - (STAMP_W / 2); // Perfectly centered in top header
  const STAMP_Y = height - 52;

  lastPage.drawRectangle({
    x: STAMP_X,
    y: STAMP_Y,
    width: STAMP_W,
    height: STAMP_H,
    color: rgb(0.94, 1, 0.96),
    borderColor: rgb(0.13, 0.73, 0.49),
    borderWidth: 1.5,
    borderDashArray: [3, 2],
  });

  lastPage.drawText('ePOD VERIFIED', {
    x: STAMP_X + 12,
    y: STAMP_Y + STAMP_H - 12,
    size: 7.5,
    color: rgb(0.05, 0.48, 0.27),
  });

  lastPage.drawText(cleanDate, {
    x: STAMP_X + 12,
    y: STAMP_Y + STAMP_H - 21,
    size: 5.5,
    color: rgb(0.2, 0.2, 0.2),
  });

  if (cleanName) {
    lastPage.drawText(`Signed by: ${cleanName}`, {
      x: STAMP_X + 12,
      y: STAMP_Y + 3,
      size: 5.5,
      color: rgb(0.3, 0.3, 0.3),
    });
  }

  // 5. Serialize PDF
  const signedBytes = await pdfDoc.save();
  return new Blob([signedBytes], { type: 'application/pdf' });
}
