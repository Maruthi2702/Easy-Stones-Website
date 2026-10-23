import { useEffect, useRef, useState } from 'react';
import { Eye, FileSpreadsheet, FileText, Loader2, MoreHorizontal, QrCode } from 'lucide-react';
import { API_URL } from '../../../config/api';
import { checkInPdfUrl } from '../../../utils/checkInExport.js';

/**
 * The Check-In Log's More menu (⋯): View as PDF, Download as PDF, Download as
 * Excel, and the QR / NFC codes for those Users & Roles allows. The PDFs are
 * plain links to the server (GET /api/checkin/export.pdf), so View opens its
 * tab straight from the tap; the Excel file is made by `onExport`.
 */
export type CheckInMoreMenuProps = {
  onExport?: (() => void) | null;
  isExporting: boolean;
  /** { search, month, year, location } the PDFs are made for. */
  exportFilters: Record<string, unknown>;
  canSeeQrCodes: boolean;
  onOpenQr: () => void;
};

export default function CheckInMoreMenu({ onExport, isExporting, exportFilters, canSeeQrCodes, onOpenQr }: CheckInMoreMenuProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const viewerZone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; } })();
  const pdfViewHref = checkInPdfUrl(API_URL, exportFilters, { tz: viewerZone });
  const pdfDownloadHref = checkInPdfUrl(API_URL, exportFilters, { tz: viewerZone, download: true });
  useEffect(() => {
    if (!moreOpen) return undefined;
    moreRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    const onDown = (e: Event) => { if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setMoreOpen(false); moreRef.current?.querySelector('button')?.focus(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const items = [...(moreRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') || [])];
      if (!items.length) return;
      e.preventDefault();
      const at = items.indexOf(document.activeElement as HTMLElement);
      items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [moreOpen]);

  return (
    <div className="clp-filter-container clp-more" ref={moreRef}>
      <button
        type="button"
        className="clp-filter-btn clp-more-btn"
        aria-label="More"
        title="More"
        aria-haspopup="menu"
        aria-expanded={moreOpen}
        onClick={() => setMoreOpen((o) => !o)}
      >
        {isExporting ? <Loader2 size={15} className="clp-spin" /> : <MoreHorizontal size={16} />}
      </button>
      {moreOpen && (
        <div className="clp-more-menu" role="menu" aria-label="More">
          {onExport && (<>
          <a role="menuitem" className="clp-more-item" href={pdfViewHref} target="_blank" rel="noopener noreferrer" onClick={() => setMoreOpen(false)}>
            <Eye size={16} aria-hidden="true" />View as PDF
          </a>
          <a role="menuitem" className="clp-more-item" href={pdfDownloadHref} onClick={() => setMoreOpen(false)}>
            <FileText size={16} aria-hidden="true" />Download as PDF
          </a>
          <button
            type="button" role="menuitem" className="clp-more-item"
            aria-disabled={isExporting}
            onClick={() => { if (isExporting) return; setMoreOpen(false); onExport(); }}
          >
            <FileSpreadsheet size={16} aria-hidden="true" />{isExporting ? 'Preparing Excel…' : 'Download as Excel'}
          </button>
          </>)}
          {/* Below the downloads, for those Users & Roles allows. */}
          {canSeeQrCodes && (<>
            {onExport && <div className="clp-more-sep" role="separator" />}
            <button
              type="button" role="menuitem" className="clp-more-item"
              onClick={() => { setMoreOpen(false); onOpenQr(); }}
            >
              <QrCode size={16} aria-hidden="true" />QR / NFC codes
            </button>
          </>)}
        </div>
      )}
    </div>
  );
}
