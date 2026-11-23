import type { CapacitorConfig } from '@capacitor/cli'
import type { KeyboardResize } from '@capacitor/keyboard'

// The iOS shell loads the live site (same origin as the API) instead of a
// bundled copy: the staff and supplier sign-in cookies are first-party there,
// and iOS (ITP) blocks them from a capacitor:// page calling the API
// cross-site. Point CAP_SERVER_URL at a preview to test a branch.
const server = process.env.CAP_SERVER_URL || 'https://easystones.onrender.com'

const config: CapacitorConfig = {
  appId: 'app.easysurfaces',
  appName: 'Easy Surfaces',
  webDir: 'dist',
  server: {
    url: server,
    cleartext: false,
    // Links on these hosts stay in the app; anything else opens in Safari.
    allowNavigation: [new URL(server).host],
  },
  ios: {
    contentInset: 'always',
    // The site scrolls inside its own panels; the outer web view must not rubber-band under them.
    scrollEnabled: false,
    backgroundColor: '#000000',
  },
  android: {
    // Same live site as the iPhone app (the sign-in cookies stay first-party); never a plain-http page or a debuggable web view.
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
    backgroundColor: '#000000',
  },
  plugins: {
    SplashScreen: { launchAutoHide: true, backgroundColor: '#000000' },
    // The plugin types this as an enum; the native side reads the plain string.
    Keyboard: { resize: 'none' as KeyboardResize },
    // Show the banner and play the sound for a push that arrives while the app is open (iOS hides it otherwise).
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
  },
}

export default config
