import { useEffect, useState } from 'react';

/**
 * The full-screen photo / PDF viewer's state (ImageGallery): which file is
 * open, the set it came from, and ← → Esc while it is. Moved out of SalesPage
 * unchanged (2026-10-24); `setFullScreenImage` opens one file on its own (the
 * visit and resource forms).
 */
export function useImageGallery() {
    const [fullScreenImage, setFullScreenImage] = useState<string | null>(null);
    const [fullScreenGallery, setFullScreenGallery] = useState<string[]>([]);
    const [fullScreenIndex, setFullScreenIndex] = useState(0);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!fullScreenImage) return;
            if (e.key === 'ArrowRight') handleNextImage();
            if (e.key === 'ArrowLeft') handlePrevImage();
            if (e.key === 'Escape') setFullScreenImage(null);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the handlers read the same three values
    }, [fullScreenImage, fullScreenIndex, fullScreenGallery]);

    const handleOpenGallery = (images: string[] | string, index: number) => {
        const imageList = Array.isArray(images) ? images : [images];
        setFullScreenGallery(imageList);
        setFullScreenIndex(index);
        setFullScreenImage(imageList[index]);
    };

    const handleNextImage = () => {
        if (fullScreenGallery.length <= 1) return;
        const nextIndex = (fullScreenIndex + 1) % fullScreenGallery.length;
        setFullScreenIndex(nextIndex);
        setFullScreenImage(fullScreenGallery[nextIndex]);
    };

    const handlePrevImage = () => {
        if (fullScreenGallery.length <= 1) return;
        const prevIndex = (fullScreenIndex - 1 + fullScreenGallery.length) % fullScreenGallery.length;
        setFullScreenIndex(prevIndex);
        setFullScreenImage(fullScreenGallery[prevIndex]);
    };

    const closeGallery = () => {
        setFullScreenImage(null);
        setFullScreenGallery([]);
    };

    return {
        fullScreenImage, setFullScreenImage, fullScreenIndex, galleryCount: fullScreenGallery.length,
        handleOpenGallery, handleNextImage, handlePrevImage, closeGallery
    };
}

/** What the hook returns. */
export type ImageGalleryState = ReturnType<typeof useImageGallery>;
