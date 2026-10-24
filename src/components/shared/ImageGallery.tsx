import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { API_URL } from '../../config/api';
import { isPdfSource } from '../../utils/attachments';

export type ImageGalleryProps = {
    /** The photo or PDF on screen: a data URL, a link, an /uploads path or a stored file name. */
    image: string;
    index: number;
    count: number;
    onPrev: () => void;
    onNext: () => void;
    onClose: () => void;
};

/** A photo or PDF full screen, with previous / next when there are several (useImageGallery). */
export default function ImageGallery({ image, index, count, onPrev, onNext, onClose }: ImageGalleryProps) {
    return (
        <div className="fullscreen-image-overlay" onClick={onClose}>
            <div className="fullscreen-image-container" onClick={(e) => e.stopPropagation()} style={{ width: isPdfSource(image) ? '80%' : 'auto', height: isPdfSource(image) ? '90%' : 'auto', maxWidth: '90%', maxHeight: '90%' }}>
                <button className="fullscreen-close-btn" onClick={onClose}>
                    <X size={32} />
                </button>

                {count > 1 && (
                    <>
                        <button className="gallery-nav-btn prev" onClick={(e) => { e.stopPropagation(); onPrev(); }}>
                            <ChevronLeft size={48} />
                        </button>
                        <button className="gallery-nav-btn next" onClick={(e) => { e.stopPropagation(); onNext(); }}>
                            <ChevronRight size={48} />
                        </button>
                        <div className="gallery-index-indicator">
                            {index + 1} / {count}
                        </div>
                    </>
                )}

                {isPdfSource(image) ? (
                    <iframe src={image} style={{ width: '100%', height: '100%', border: 'none', background: 'white' }} title="PDF Preview"></iframe>
                ) : (
                    <img
                        src={image.startsWith('data:') || image.startsWith('http') ? image : (image.startsWith('/uploads') ? `${API_URL}${image}` : `${API_URL}/uploads/resources/${image}`)}
                        alt="Full Screen"
                    />
                )}
            </div>
        </div>
    );
}
