import { Check, Copy, Printer, QrCode, Smartphone, X } from 'lucide-react';
import LocationPicker from '../../../components/shared/form/LocationPicker';
import type { useQrCodes } from './useQrCodes';

/**
 * The QR / NFC self check-in codes: which branch, the QR to print or scan,
 * and the NFC tag link. Its choices (`qr`, from useQrCodes) are held by the
 * panel, so the branch and domain picked last are still set on reopening.
 */
export type QrCodesModalProps = {
  qr: ReturnType<typeof useQrCodes>;
  locations: unknown[];
  user: unknown;
  /** Only an admin may change the domain the codes point at. */
  isAdmin: boolean;
  onClose: () => void;
};

export default function QrCodesModal({ qr, locations, user, isAdmin, onClose }: QrCodesModalProps) {
  return (
    <div className="selection-modal-overlay" onClick={() => onClose()}>
      <div className="selection-modal-container clp-qr-modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="selection-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <QrCode size={20} style={{ color: '#d4af37' }} />
            <h2 className="selection-modal-header-title">QR Code & NFC Showroom Check-In</h2>
          </div>
          <button className="selection-modal-close" onClick={() => onClose()}>
            <X size={18} />
          </button>
        </div>

        <div className="selection-modal-form clp-qr-modal-body">
          {/* Branch Office Location & Domain Selector */}
          <div className="clp-qr-fields">
            <div className="clp-qr-location-selector">
              <label className="clp-qr-label" htmlFor="clp-qr-location">
                Showroom Branch Location:
              </label>
              <LocationPicker
                id="clp-qr-location"
                value={qr.location || ''}
                onChange={qr.setLocation}
                options={locations.length > 0 ? locations : ['Seattle', 'Spokane', 'Salt Lake City']}
                user={user}
                sheetTitle="Showroom branch"
              />
            </div>

            <div className="clp-qr-location-selector">
              <label className="clp-qr-label">
                Target Domain URL {!isAdmin && <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontStyle: 'italic' }}>(Admin only)</span>}:
              </label>
              <input
                type="text"
                value={qr.domain}
                onChange={(e) => isAdmin && qr.setDomain(e.target.value)}
                readOnly={!isAdmin}
                disabled={!isAdmin}
                placeholder={window.location.origin}
                className="clp-qr-select"
                style={!isAdmin ? { opacity: 0.75, cursor: 'not-allowed' } : {}}
              />
            </div>
          </div>

          {/* Dynamic QR Code Display */}
          <div className="clp-qr-preview-card">
            <a
              href={`/self-checkin?location=${encodeURIComponent(qr.location)}&mode=qr`}
              target="_blank"
              rel="noopener noreferrer"
              className="clp-qr-code-wrapper"
              title="Click to open and test self check-in for this location"
            >
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(`${qr.domain.replace(/\/$/, '')}/self-checkin?location=${encodeURIComponent(qr.location)}&mode=qr`)}`}
                alt={`QR Code for ${qr.location}`}
                className="clp-qr-image"
              />
            </a>
            <div className="clp-qr-info">
              <h4>{qr.location} Showroom Self Check-In</h4>
              <p>Customers can scan this QR code or tap an NFC tag to open the check-in form directly on their mobile phones.</p>
              <p style={{ marginTop: '8px', fontSize: '0.78rem', color: '#10b981', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span>🔗 URL: <code>{`${qr.domain.replace(/\/$/, '')}/self-checkin?location=${encodeURIComponent(qr.location)}`}</code></span>
                <a
                  href={`/self-checkin?location=${encodeURIComponent(qr.location)}&mode=qr`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ textDecoration: 'underline', color: '#d4af37', fontWeight: 'bold', cursor: 'pointer' }}
                >
                  [ Test Link ↗ ]
                </a>
              </p>
            </div>
          </div>

          {/* NFC Link Section */}
          <div className="clp-nfc-card">
            <div className="clp-nfc-header">
              <Smartphone size={16} style={{ color: '#10b981' }} />
              <strong>NFC Tag URL (1-Click Copy for Tag Writer):</strong>
            </div>
            <div className="clp-nfc-url-row">
              <input
                type="text"
                readOnly
                value={`${qr.domain.replace(/\/$/, '')}/self-checkin?location=${encodeURIComponent(qr.location)}&mode=nfc`}
                className="clp-nfc-input"
              />
              <button
                type="button"
                className="clp-nfc-copy-btn"
                onClick={() => {
                  const url = `${qr.domain.replace(/\/$/, '')}/self-checkin?location=${encodeURIComponent(qr.location)}&mode=nfc`;
                  navigator.clipboard.writeText(url);
                  qr.setCopied(true);
                  setTimeout(() => qr.setCopied(false), 2000);
                }}
              >
                {qr.copied ? <Check size={14} /> : <Copy size={14} />}
                <span>{qr.copied ? 'Copied!' : 'Copy'}</span>
              </button>
            </div>
            <p className="clp-nfc-hint">
              💡 Tip: Use any free app like <strong>NFC Tools</strong> on iPhone/Android to write this URL to a $0.50 NFC NTAG215 sticker for instant tap-to-check-in on front desk counters.
            </p>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="selection-modal-actions" style={{ justifyContent: 'space-between' }}>
          <button
            type="button"
            className="clp-qr-btn-print"
            onClick={() => {
              const printUrl = `${qr.domain.replace(/\/$/, '')}/self-checkin?location=${encodeURIComponent(qr.location)}&mode=qr`;
              const printWin = window.open('', '_blank');
              printWin!.document.write(`
                <html>
                  <head>
                    <title>Easy Stones Check-In Poster - ${qr.location}</title>
                    <style>
                      body { font-family: system-ui, sans-serif; text-align: center; padding: 40px; color: #0f172a; }
                      .poster { max-width: 500px; margin: 0 auto; border: 2px solid #d4af37; padding: 40px; border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); }
                      h1 { color: #b48a1c; font-size: 28px; margin-bottom: 5px; }
                      h2 { color: #334155; font-size: 20px; font-weight: 500; margin-top: 0; }
                      .qr-img { width: 220px; height: 220px; margin: 20px 0; border: 4px solid #f1f5f9; padding: 10px; border-radius: 12px; }
                      .instructions { font-size: 16px; color: #475569; margin-top: 15px; }
                      .badge { display: inline-block; background: #fef3c7; color: #b48a1c; padding: 6px 16px; border-radius: 20px; font-weight: 700; margin-bottom: 20px; }
                    </style>
                  </head>
                  <body>
                    <div class="poster">
                      <div class="badge">EASY STONES • ${qr.location.toUpperCase()} SHOWROOM</div>
                      <h1>Welcome! Visitor Check-In</h1>
                      <h2>Please Scan QR Code or Tap NFC to Check In</h2>
                      <img src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(printUrl)}" class="qr-img" />
                      <p class="instructions">📱 Open Phone Camera to Scan<br>⚡ Or Tap Phone Here for NFC Check-In</p>
                    </div>
                    <script>window.onload = () => { window.print(); };</script>
                  </body>
                </html>
              `);
              printWin!.document.close();
            }}
          >
            <Printer size={15} /> Print Showroom Poster
          </button>
          <button type="button" className="clp-qr-btn-close" onClick={() => onClose()}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
