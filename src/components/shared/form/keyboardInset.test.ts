import { describe, expect, it } from 'vitest';
import { phoneViewportFor, type ViewportReading } from './keyboardInset';

const base: ViewportReading = { innerHeight: 780, vvHeight: 780, vvOffsetTop: 0, vvScale: 1, nativeKb: 0, native: false };

describe('phoneViewportFor', () => {
    it('no keyboard: the whole screen', () => {
        expect(phoneViewportFor(base)).toEqual({ kb: 0, viewHeight: 780 });
        expect(phoneViewportFor({ ...base, native: true })).toEqual({ kb: 0, viewHeight: 780 });
    });

    it('phone browser: the keyboard is what the visual viewport lost, the form is the visual viewport', () => {
        expect(phoneViewportFor({ ...base, vvHeight: 440 })).toEqual({ kb: 340, viewHeight: 440 });
    });

    it('phone browser: a pinch-zoom is not a keyboard', () => {
        expect(phoneViewportFor({ ...base, vvHeight: 390, vvScale: 2 })).toEqual({ kb: 0, viewHeight: 390 });
    });

    it('the app, web view not resized: the phone-reported keyboard height is taken off the screen', () => {
        expect(phoneViewportFor({ ...base, native: true, nativeKb: 336 })).toEqual({ kb: 336, viewHeight: 444 });
    });

    it('the app, web view\'s visual viewport also shrinks: still screen minus keyboard, never the full screen', () => {
        // The React Native WebView reports both. The form used to stay 780 tall with its lower half under the keyboard.
        expect(phoneViewportFor({ ...base, native: true, nativeKb: 336, vvHeight: 444 })).toEqual({ kb: 336, viewHeight: 444 });
    });

    it('the app, visual viewport shrinks before the phone has reported the keyboard (will-show not yet delivered)', () => {
        expect(phoneViewportFor({ ...base, native: true, nativeKb: 0, vvHeight: 444 })).toEqual({ kb: 336, viewHeight: 444 });
    });

    it('never negative', () => {
        expect(phoneViewportFor({ ...base, native: true, nativeKb: 900 })).toEqual({ kb: 900, viewHeight: 0 });
    });
});
