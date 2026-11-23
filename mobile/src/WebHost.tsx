import { useMemo, useRef } from 'react';
import { Linking, Platform, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewNavigation } from 'react-native-webview';
import { HOME_PATH, SERVER_HOST, SERVER_URL } from './config';
import { shimFor } from './host/protocol';
import HostRouter from './host/router';
import { PLUGINS } from './host/plugins';

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

  const onNavigation = (nav: WebViewNavigation) => {
    if (hostOf(nav.url) === SERVER_HOST && LOGIN_PATHS.has(pathOf(nav.url))) onSignedOut();
  };

  return (
    <WebView<unknown>
      ref={ref}
      style={styles.web}
      source={{ uri: `${SERVER_URL}${HOME_PATH}` }}
      injectedJavaScriptBeforeContentLoaded={shim}
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
      mediaCapturePermissionGrantType="grant"
      setSupportMultipleWindows={false}
      bounces={false}
      overScrollMode="never"
      allowsBackForwardNavigationGestures
      webviewDebuggingEnabled={false}
    />
  );
}

const styles = StyleSheet.create({ web: { flex: 1, backgroundColor: '#000000' } });
