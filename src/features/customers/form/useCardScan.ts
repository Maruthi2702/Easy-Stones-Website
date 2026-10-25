/**
 * Filling the form from a business card — the + next to the ✕: the camera
 * (with Capture) or a photo, read with Tesseract, then parsed
 * (src/utils/cardParser.ts) and merged into what's typed (applyCardScan).
 * Every stop bumps a counter, so a camera that finishes starting after the
 * form closed (or Stop camera was pressed) is switched off instead of kept.
 */
import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import Tesseract from 'tesseract.js';
import { parseBusinessCard } from '../../../utils/cardParser';
import { applyCardScan } from '../../../utils/customerForm';
import type { CustomerFormValues } from '../../../utils/customerForm';
import type { Loose } from '../../../types/records';
import { SCAN_NOTES } from './customerFormView';

const ocr = (image: string, onProgress: (percent: number) => void): Promise<string> =>
    Tesseract.recognize(image, 'eng', {
        logger: (m) => { if (m.status === 'recognizing text') onProgress(Math.floor(m.progress * 100)); }
    }).then((r) => r.data.text);

export type CardScanDeps = {
    isPhone: boolean;
    initial: CustomerFormValues;
    setValues: React.Dispatch<React.SetStateAction<CustomerFormValues>>;
};

export function useCardScan({ isPhone, initial, setValues }: CardScanDeps) {
    const [menuOpen, setMenuOpen] = useState(false);
    const [scan, setScan] = useState({ status: 'idle', progress: 0, result: '' }); // idle | camera | reading
    const plusRef = useRef<HTMLDivElement | null>(null);
    const fileRef = useRef<HTMLInputElement | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);

    useEffect(() => {
        if (!menuOpen || isPhone) return undefined;
        const onDown = (e: MouseEvent) => { if (!plusRef.current?.contains(e.target as Node)) setMenuOpen(false); };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [menuOpen, isPhone]);

    // Bumped by every stop, so a camera that finishes starting after the form
    // closed (or Stop camera was pressed) is switched off instead of kept.
    const cameraRun = useRef(0);
    const stopCamera = () => {
        cameraRun.current += 1;
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (videoRef.current) videoRef.current.srcObject = null;
    };
    useEffect(() => stopCamera, []);

    const readCard = async (image: string) => {
        setScan({ status: 'reading', progress: 0, result: '' });
        try {
            const text = await ocr(image, (p) => setScan((s) => ({ ...s, progress: p })));
            const parsed = parseBusinessCard(text);
            // Whether anything was found depends only on the card; the values
            // are merged in the updater so typing during the read isn't lost.
            const { found } = applyCardScan(initial, parsed as Loose | null);
            if (found) setValues((v) => applyCardScan(v, parsed as Loose | null).values);
            setScan({ status: 'idle', progress: 0, result: found ? 'filled' : 'nothing' });
        } catch (err) {
            console.error('Card scan failed:', err);
            setScan({ status: 'idle', progress: 0, result: 'failed' });
        }
    };

    const startCamera = async () => {
        setMenuOpen(false);
        setScan({ status: 'camera', progress: 0, result: '' });
        const run = ++cameraRun.current;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
            });
            // Closed (or stopped) while the permission prompt was up.
            if (run !== cameraRun.current) {
                stream.getTracks().forEach((t) => t.stop());
                return;
            }
            streamRef.current = stream;
            if (videoRef.current) videoRef.current.srcObject = stream;
        } catch (err) {
            console.error('Camera error:', err);
            setScan({ status: 'idle', progress: 0, result: 'nocamera' });
        }
    };
    const capture = () => {
        const video = videoRef.current;
        if (!video || !video.videoWidth) return;
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
        const image = canvas.toDataURL('image/jpeg');
        stopCamera();
        readCard(image);
    };
    const onPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => readCard(ev.target!.result as string);
        reader.readAsDataURL(file);
    };
    const pickPhoto = () => { setMenuOpen(false); fileRef.current?.click(); };
    const stopScanning = () => { stopCamera(); setScan({ status: 'idle', progress: 0, result: '' }); };

    return {
        card: { menuOpen, setMenuOpen, scan, scanNote: SCAN_NOTES[scan.result], stopCamera, startCamera, capture, onPhoto, pickPhoto, stopScanning },
        refs: { plusRef, fileRef, videoRef, streamRef }
    };
}

/** The card's state and actions (the refs the parts attach go separately: CardRefs). */
export type CardScan = ReturnType<typeof useCardScan>['card'];
export type CardRefs = ReturnType<typeof useCardScan>['refs'];
