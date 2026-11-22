import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { Keyboard, KeyboardStyle } from '@capacitor/keyboard';

const FIELD = 'input, textarea, select, [contenteditable="true"]';

/** True when the field sits in a pinned (position: fixed) pop-up or sheet, which places itself (see "Phones" in CLAUDE.md). */
function inPinnedPanel(el: Element): boolean {
  for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
    if (getComputedStyle(n).position === 'fixed') return true;
  }
  return false;
}

/**
 * Phones: the keyboard covers the page (the web view doesn't resize,
 * `Keyboard.resize: 'none'`), so a text box low on a page like the sign-in sat
 * behind it. While the keyboard is up the page gets that much blank space at
 * its end (`--native-kb`) and the focused box is scrolled to the middle of the
 * visible part. Pop-ups and sheets that are pinned to the screen are left to
 * their own rules. Draws nothing. In a phone-size browser it only brings the focused box into view.
 */
export default function NativeKeyboard() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      // Phone-size browser: the browser makes room for its own keyboard, but doesn't always bring a low box into view.
      const onFocusBrowser = (e: FocusEvent) => {
        const el = e.target;
        if (!(el instanceof Element) || !el.matches(FIELD) || !window.matchMedia('(max-width: 639px)').matches) return;
        if (inPinnedPanel(el)) return;
        window.setTimeout(() => {
          if (document.activeElement === el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }, 350);
      };
      document.addEventListener('focusin', onFocusBrowser);
      return () => document.removeEventListener('focusin', onFocusBrowser);
    }
    const root = document.documentElement;
    // The app can't be zoomed: the web view never scrolls (scrollEnabled: false), so a pinch, a
    // double-tap, or iOS zooming in on a small text box left the whole screen stuck zoomed with
    // no way back. Only in the iOS app — the website keeps normal zoom.
    document.querySelector('meta[name="viewport"]')?.setAttribute(
      'content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
    root.style.setProperty('touch-action', 'manipulation');
    // The keyboard follows the app's theme (body.light-theme-active), not the phone's: a dark
    // keyboard under a light sheet looked broken. Set now and whenever the theme flips.
    const matchKeyboardToTheme = () => {
      const light = document.body.classList.contains('light-theme-active');
      void Keyboard.setStyle({ style: light ? KeyboardStyle.Light : KeyboardStyle.Dark }).catch(() => {});
    };
    matchKeyboardToTheme();
    const themeWatcher = new MutationObserver(matchKeyboardToTheme);
    themeWatcher.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    const reveal = () => {
      const el = document.activeElement;
      if (!el || !el.matches(FIELD) || inPinnedPanel(el)) return;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    };
    const shown = Keyboard.addListener('keyboardDidShow', ({ keyboardHeight }) => {
      root.style.setProperty('--native-kb', `${keyboardHeight}px`);
      root.classList.add('native-kb-up');
      window.dispatchEvent(new Event('native-keyboard'));
      reveal();
    });
    const hidden = Keyboard.addListener('keyboardDidHide', () => {
      root.classList.remove('native-kb-up');
      root.style.removeProperty('--native-kb');
      window.dispatchEvent(new Event('native-keyboard'));
    });
    // Moving between boxes with the keyboard already up.
    const onFocus = (e: FocusEvent) => {
      if (root.classList.contains('native-kb-up') && e.target instanceof Element && e.target.matches(FIELD)) {
        window.setTimeout(reveal, 50);
      }
    };
    document.addEventListener('focusin', onFocus);
    return () => {
      themeWatcher.disconnect();
      document.removeEventListener('focusin', onFocus);
      void shown.then(h => h.remove());
      void hidden.then(h => h.remove());
      root.classList.remove('native-kb-up');
      root.style.removeProperty('--native-kb');
    };
  }, []);
  return null;
}
