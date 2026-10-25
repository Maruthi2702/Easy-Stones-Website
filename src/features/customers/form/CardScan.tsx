/**
 * The business card's parts in Add / Edit customer: the + button next to the ✕
 * (a menu on desktop, a sheet on phones), and in the body the hidden photo
 * input, the camera with Capture, the reading progress and the note after.
 */
import { Camera, Plus, Upload } from 'lucide-react';
import { FormSheet } from '../../../components/shared/form/FormControls';
import type { CardScan, CardRefs } from './useCardScan';

function CardItems({ card }: { card: CardScan }) {
    return (
        <>
            <button type="button" role="menuitem" className="fm-opt" onClick={card.startCamera}>
                <Camera size={18} aria-hidden="true" /><span className="fm-opt-label">Scan card</span>
            </button>
            <button type="button" role="menuitem" className="fm-opt" onClick={card.pickPhoto}>
                <Upload size={18} aria-hidden="true" /><span className="fm-opt-label">Upload card photo</span>
            </button>
        </>
    );
}

/** The + next to the ✕ (the form's header actions). */
export function CardMenuButton({ card, plusRef, isPhone, isSaving }: { card: CardScan; plusRef: CardRefs['plusRef']; isPhone: boolean; isSaving: boolean }) {
    const { menuOpen, setMenuOpen, scan } = card;
    return (
        <div
            className="cf-plus"
            ref={plusRef}
            onKeyDown={(e) => { if (e.key === 'Escape' && menuOpen) { e.stopPropagation(); setMenuOpen(false); } }}
        >
            <button
                type="button"
                className="cf-plus-btn"
                aria-label="Fill in from a business card"
                title="Fill in from a business card"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                disabled={isSaving || scan.status !== 'idle'}
                onClick={() => setMenuOpen((o) => !o)}
            >
                <Plus size={18} strokeWidth={2.4} aria-hidden="true" />
            </button>
            {menuOpen && !isPhone && <div className="fm-menu cf-plus-menu" role="menu"><CardItems card={card} /></div>}
        </div>
    );
}

/** The top of the form's body: the photo input, the phone's sheet, the camera, the read and its note. */
export function CardScanPanel({ card, fileRef, videoRef, streamRef, isPhone }: {
    card: CardScan; fileRef: CardRefs['fileRef']; videoRef: CardRefs['videoRef']; streamRef: CardRefs['streamRef']; isPhone: boolean;
}) {
    const { scan, scanNote } = card;
    return (
        <>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={card.onPhoto} />
            {isPhone && (
                <FormSheet open={card.menuOpen} title="Business card" onClose={() => card.setMenuOpen(false)}>
                    <div role="menu" aria-label="Business card"><CardItems card={card} /></div>
                </FormSheet>
            )}

            {scan.status === 'camera' && (
                <div className="cf-scan" role="region" aria-label="Scan a business card">
                    <div className="cf-scan-frame">
                        <video
                            ref={(el) => { videoRef.current = el; if (el && streamRef.current && el.srcObject !== streamRef.current) el.srcObject = streamRef.current; }}
                            autoPlay
                            playsInline
                            muted
                            className="cf-scan-video"
                        />
                        <div className="cf-scan-guide" aria-hidden="true" />
                    </div>
                    <div className="cf-scan-actions">
                        <button type="button" className="fm-btn" onClick={card.stopScanning}>Stop camera</button>
                        <button type="button" className="fm-btn fm-btn-primary" onClick={card.capture}><Camera size={16} aria-hidden="true" />Capture</button>
                    </div>
                </div>
            )}
            {scan.status === 'reading' && (
                <div className="cf-scan cf-scan-reading" role="status">
                    <span className="cf-scan-reading-text"><span className="fm-spinner" aria-hidden="true" />Reading the card… {scan.progress}%</span>
                    <span className="cf-progress"><span style={{ width: `${scan.progress}%` }} /></span>
                </div>
            )}
            {scanNote && scan.status === 'idle' && (
                <div className={`cf-scan-note${scanNote.tone === 'err' ? ' cf-scan-note-err' : ''}`} role="status">{scanNote.text}</div>
            )}
        </>
    );
}
