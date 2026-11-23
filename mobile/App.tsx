import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import LoginScreen from './src/auth/LoginScreen';
import { hasValidSession } from './src/auth/signIn';
import WebHost from './src/WebHost';
import LocationConsent from './src/location/LocationConsent';

type Screen = 'checking' | 'login' | 'web';

/**
 * The app's one flow (the iPhone app's RootViewController): the website underneath, and the native sign-in screen whenever nobody is
 * signed in. On launch, saved cookies that still sign someone in skip the screen; otherwise it shows and offers Face ID /
 * fingerprint first.
 */
export default function App() {
  const [screen, setScreen] = useState<Screen>('checking');
  const [afterSignOut, setAfterSignOut] = useState(false);

  useEffect(() => { void hasValidSession().then((ok) => setScreen(ok ? 'web' : 'login')); }, []);

  return (
    <SafeAreaProvider>
      {/* The sign-in screen is full-bleed (the slab runs behind the status bar), so it sits outside the safe-area frame. */}
      <StatusBar style={screen === 'login' ? 'auto' : 'light'} />
      {screen === 'login' ? <LoginScreen offerBiometricNow={!afterSignOut} onSignedIn={() => { setAfterSignOut(false); setScreen('web'); }} /> : (
        <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
          {screen === 'checking' ? <View style={styles.center}><ActivityIndicator color="#c9a24b" /></View> : null}
          {screen === 'web' ? <WebHost onSignedOut={() => { setAfterSignOut(true); setScreen('login'); }} /> : null}
        </SafeAreaView>
      )}
      {/* The phone's own location screens (agreement, "location is off"), over the website. */}
      <LocationConsent active={screen === 'web'} />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: '#000000' }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' } });
