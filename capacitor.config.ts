import type { CapacitorConfig } from '@capacitor/cli'

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
    contentInset: 'never',
    backgroundColor: '#000000',
  },
  plugins: {
    SplashScreen: { launchAutoHide: true, backgroundColor: '#000000' },
    Keyboard: { resize: 'none' },
  },
}

export default config
