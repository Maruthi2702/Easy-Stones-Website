import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, FileText, X } from 'lucide-react';
import { API_URL } from '../../config/api';
import { isPdfSource } from '../../utils/attachments';
import './ImageGallery.css';

export type ImageGalleryProps = {
    /** The photo or PDF on screen: a data URL, a link, an /uploads path or a stored file name. */
    image: string;
    index: number;
    count: number;
    /** The whole set, for the thumbnail strip (shown when there are several). */
    images?: string[];
    onPrev: () => void;
    onNext: () => void;
    /** A thumbnail was picked. */
    onSelect?: (index: number) => void;
    onClose: () => void;
};

/** A photo's address: data URLs and links as they are, an /uploads path or a bare file name on the API. */
function photoSrc(image: string): string {
    if (image.startsWith('data:') || image.startsWith('http')) return image;
    return image.startsWith('/uploads') ? `${API_URL}${image}` : `${API_URL}/uploads/resources/${image}`;
}

/** How far a finger has to travel sideways before it counts as a swipe. */
const SWIPE_PX = 50;

/**
 * A photo or PDF full screen, with previous / next, a thumbnail strip and
 * swipe when there are several (useImageGallery).
 * Portaled to <body> at the forms' z-index: it opens from inside a FormModal (View
 * resource, the visit form), which is itself portaled at the top z-index, and a
 * later sibling with the same z-index paints on top. Esc closes only the photo.
 */
export default function ImageGallery({ image, index, count, images, onPrev, onNext, onSelect, onClose }: ImageGalleryProps) {
    const touchStart = useRef<{ x: number; y: number } | null>(null);
    const activeThumb = useRef<HTMLButtonElement | null>(null);
    const several = count > 1;
    const isPdf = isPdfSource(image);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation();
            onClose();
        };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, [onClose]);

    // Keep the current thumbnail in view, scrolling only the strip (not the page).
    useEffect(() => {
        const thumb = activeThumb.current;
        const strip = thumb?.parentElement;
        if (!thumb || !strip) return;
        strip.scrollTo({ left: thumb.offsetLeft - (strip.clientWidth - thumb.clientWidth) / 2, behavior: 'smooth' });
    }, [index]);

    const onTouchStart = (e: React.TouchEvent) => {
        touchStart.current = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
    };
    const onTouchEnd = (e: React.TouchEvent) => {
        const start = touchStart.current;
        touchStart.current = null;
        if (!start || !several) return;
        const dx = e.changedTouches[0].clientX - start.x;
        const dy = e.changedTouches[0].clientY - start.y;
        if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy)) return;
        if (dx < 0) onNext(); else onPrev();
    };

    const stop = (e: React.MouseEvent) => e.stopPropagation();

    return createPortal(
        <div
            className={`ig-overlay${several ? '' : ' is-single'}`}
            role="dialog"
            aria-modal="true"
            aria-label="Photo viewer"
            onClick={onClose}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
        >
            <div className="ig-top">
                {several && <span className="ig-count">{index + 1} / {count}</span>}
                <button type="button" className="ig-btn" aria-label="Close" onClick={(e) => { stop(e); onClose(); }}>
                    <X size={22} />
                </button>
            </div>

            {several && (
                <>
                    <button type="button" className="ig-btn ig-nav ig-prev" aria-label="Previous" onClick={(e) => { stop(e); onPrev(); }}>
                        <ChevronLeft size={26} />
                    </button>
                    <button type="button" className="ig-btn ig-nav ig-next" aria-label="Next" onClick={(e) => { stop(e); onNext(); }}>
                        <ChevronRight size={26} />
                    </button>
                </>
            )}

            <div className="ig-stage">
                {isPdf ? (
                    <iframe key={image} className="ig-media ig-pdf" src={image} title="PDF preview" onClick={stop} />
                ) : (
                    <img key={image} className="ig-media" src={photoSrc(image)} alt={several ? `Photo ${index + 1} of ${count}` : 'Photo'} onClick={stop} draggable={false} />
                )}
            </div>

            {several && images && images.length > 1 && (
                <div className="ig-thumbs" onClick={stop}>
                    {images.map((src, i) => (
                        <button
                            key={`${i}-${src.slice(0, 40)}`}
                            ref={i === index ? activeThumb : undefined}
                            type="button"
                            className={`ig-thumb${i === index ? ' is-active' : ''}`}
                            aria-label={`Show ${i + 1} of ${count}`}
                            aria-current={i === index ? 'true' : undefined}
                            onClick={() => onSelect?.(i)}
                        >
                            {isPdfSource(src) ? <FileText size={22} /> : <img src={photoSrc(src)} alt="" draggable={false} />}
                        </button>
                    ))}
                </div>
            )}
        </div>,
        document.body
    );
}
