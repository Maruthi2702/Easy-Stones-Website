/**
 * What the Capacitor iPhone app did to its web view that the React Native WebView does not do by itself — and why the website's
 * forms and search pages went blank, or lost their header, the moment a keyboard opened (2026-11-24).
 *
 * The website never scrolls the page: every screen scrolls inside its own panel, forms and sheets are `position: fixed`, and
 * the keyboard is handled by the page itself (`--native-kb`, from NativeKeyboard / FormModal). That only works while the web
 * view's own scroll view stays at offset 0. A WKWebView, left alone, does the opposite when a text box takes focus: it scrolls
 * its scroll view (and adds a bottom content inset) so the box clears the keyboard. Everything pinned to the screen — the form's
 * header, a full-screen search sheet — rides up with it and can end up off the top: a form with no title bar, then a blank page.
 *
 * Capacitor stopped that in three places (its Keyboard plugin and `ios.scrollEnabled: false` in capacitor.config.ts): scrolling
 * off, the content offset forced back to zero on every scroll, the content inset reset on every keyboard event. In
 * react-native-webview the first two are one prop: with `scrollEnabled={false}` its `scrollViewDidScroll` sets
 * `scrollView.bounds = webView.bounds`, so any scroll WebKit does for the keyboard is undone the same frame. The inset
 * adjustments are switched off so nothing else shifts the page.
 *
 * iOS only: `scrollEnabled` is an iOS prop, and the Android app was never configured this way (its keyboard is the window's
 * own resize — see mobile/README.md).
 */
export type KeyboardSafeProps = {
  scrollEnabled?: boolean;
  automaticallyAdjustContentInsets?: boolean;
  contentInsetAdjustmentBehavior?: 'never';
};

export function keyboardSafeProps(os: string): KeyboardSafeProps {
  if (os !== 'ios') return {};
  return { scrollEnabled: false, automaticallyAdjustContentInsets: false, contentInsetAdjustmentBehavior: 'never' };
}
