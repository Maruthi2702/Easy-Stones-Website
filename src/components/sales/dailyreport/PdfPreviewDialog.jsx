import React, { useEffect, useState } from 'react';
import { Eye, Download, AlertCircle, Loader2, X } from 'lucide-react';
import { authFetch } from '../../../api/authFetch';

/**
 * Shows the report PDF inside the app instead of navigating the tab to it.
 *
 * A plain `window.open(url)` to a PDF is a top-level navigation, and Chrome's
 * "Download PDFs instead of automatically opening them" setting (on for a
 * lot of shared/managed machines) intercepts exactly that and forces a save
 * dialog regardless of Content-Disposition: inline — there's no server-side
 * header that overrides a client's browser preference for a full navigation.
 * An <iframe> embedded in the page isn't a top-level navigation, so it isn't
 * subject to that setting and always renders with the browser's PDF viewer.
 */
const PdfPreviewDialog = ({ open, onClose, url, title, filename }) => {
  const [blobUrl, setBlobUrl] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open || !url) return undefined;
    let cancelled = false;
    let objectUrl = null;
    setBlobUrl(null);
    setError(null);

    authFetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error('Could not load the PDF.');
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Could not load the PDF.');
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open, url]);

  if (!open) return null;

  return (
    <div className="dr-confirm-backdrop" onClick={onClose}>
      <div className="dr-pdf-preview" onClick={(e) => e.stopPropagation()}>
        <div className="dr-pdf-preview-bar">
          <span className="dr-pdf-preview-title"><Eye size={15} /> {title}</span>
          <div className="dr-pdf-preview-actions">
            {blobUrl && (
              <a className="dr-btn" href={blobUrl} download={filename}>
                <Download size={14} /> Download
              </a>
            )}
            <button type="button" className="dr-btn" onClick={onClose}><X size={14} /> Close</button>
          </div>
        </div>
        <div className="dr-pdf-preview-body">
          {error ? (
            <div className="dr-error"><AlertCircle size={15} /> <span>{error}</span></div>
          ) : blobUrl ? (
            <iframe title={title} src={blobUrl} className="dr-pdf-preview-frame" />
          ) : (
            <div className="dr-pdf-preview-loading"><Loader2 size={18} className="dr-spin" /> Loading…</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PdfPreviewDialog;
