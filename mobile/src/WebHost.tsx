import { useEffect, useMemo, useRef } from 'react';
import { Linking, Platform, StyleSheet, useColorScheme } from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewNavigation } from 'react-native-webview';
import { HOME_PATH, SERVER_HOST, SERVER_URL } from './config';
import { shimFor } from './host/protocol';
import { GEOLOCATION_SHIM } from './host/geolocationShim';
import HostRouter from './host/router';
import { PLUGINS } from './host/plugins';
import { keyboardSafeProps } from './host/webViewSettings';

/**
 * The site keeps its theme in `checkin_theme` (useSalesTheme.ts). In the app: a theme the person picked with the toggle is kept
 * (`es_theme_user`); until they pick one it is the phone's, now and whenever the phone switches. Our own write is told apart from
 * the toggle's by `__esSetting`. App only: the website is unchanged.
 */
const themeScript = (scheme: 'light' | 'dark') => `(function(){try{
var K='es_theme_user',s=localStorage;
if(!window.__esTheme){window.__esTheme=1;window.addEventListener('checkin_theme_changed',function(){
  if(window.__esSetting)return;var t=s.getItem('checkin_theme');if(t==='dark'||t==='light')s.setItem(K,t);});}
var t=s.getItem(K)||'${scheme}';
if(s.getItem('checkin_theme')!==t){window.__esSetting=1;try{s.setItem('checkin_theme',t);window.dispatchEvent(new Event('checkin_theme_changed'));}finally{window.__esSetting=0;}}
}catch(e){}})();true;`;

const LOGIN_PATHS = new Set(['/login', '/login/', '/admin/login']);
const hostOf = (url: string) => { try { return new URL(url).host; } catch { return ''; } };
const pathOf = (url: string) => { try { return new URL(url).pathname.toLowerCase(); } catch { return ''; } };

/**
 * The website, in a WebView, with the phone's plugins answered over the bridge (host/protocol.ts). Signing out in the site, or an
 * expired session, lands it on /login: that hands control back to the native sign-in screen (`onSignedOut`), as the iPhone app did.
 */
export default function WebHost({ onSignedOut }: { onSignedOut: () => void }) {
  const ref = useRef<WebView<unknown>>(null);
  const router = useMemo(() => new HostRouter(PLUGINS, (script) => ref.current?.injectJavaScript(script)), []);
  const shim = useMemo(() => shimFor(Platform.OS === 'android' ? 'android' : 'ios', PLUGINS), []);

  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  useEffect(() => { ref.current?.injectJavaScript(themeScript(scheme)); }, [scheme]);   // the phone switches (sunset, Control Centre)

  const onNavigation = (nav: WebViewNavigation) => {
    if (hostOf(nav.url) === SERVER_HOST && LOGIN_PATHS.has(pathOf(nav.url))) onSignedOut();
  };

  return (
    <WebView<unknown>
      ref={ref}
      style={styles.web}
      source={{ uri: `${SERVER_URL}${HOME_PATH}` }}
      injectedJavaScriptBeforeContentLoaded={`${themeScript(scheme)}${shim}${GEOLOCATION_SHIM}`}
      onMessage={(e) => { void router.handle(e.nativeEvent.data); }}
      onLoadStart={() => router.reset()}
      onNavigationStateChange={onNavigation}
      onShouldStartLoadWithRequest={(req) => {
        if (req.url === 'about:blank' || hostOf(req.url) === SERVER_HOST || req.url.startsWith('blob:') || req.url.startsWith('data:')) return true;
        void Linking.openURL(req.url);                       // anything else opens in the browser, like the Capacitor app
        return false;
      }}
      originWhitelist={['https://*', 'http://localhost*', 'about:*', 'blob:*', 'data:*']}
      javaScriptEnabled
      domStorageEnabled
      sharedCookiesEnabled
      thirdPartyCookiesEnabled
      allowsInlineMediaPlayback
      hideKeyboardAccessoryView                              // iOS's ⌃ ⌄ ✓ bar over the keyboard (the Capacitor app hid it too)
      mediaCapturePermissionGrantType="grant"
      setSupportMultipleWindows={false}
      bounces={false}
      {...keyboardSafeProps(Platform.OS)}                     // the web view must never scroll for the keyboard — see webViewSettings.ts
      overScrollMode="never"
      allowsBackForwardNavigationGestures
      webviewDebuggingEnabled={false}
    />
  );
}

const styles = StyleSheet.create({ web: { flex: 1, backgroundColor: '#000000' } });
