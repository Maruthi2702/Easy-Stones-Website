import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import {
  ActivityIndicator, Alert, ImageBackground, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useColorScheme, View
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { signIn } from './signIn';
import * as vault from './vault';

/**
 * The native sign-in screen, following the claude.ai artifact "Mobile Login Screen" (the same design the iPhone app's LoginView.swift
 * drew): the slab photo with a gradient over it, the mark and EASY SURFACES, two icon fields, the gold Sign in button, and — once a
 * sign-in is saved — an outlined Face ID / fingerprint button under an "or" line. Dark uses the Nero Marquina slab, light the Calacatta
 * Lincoln, by the phone's setting. `onSignedIn` runs after the server has set the session cookies.
 */
export default function LoginScreen({ onSignedIn, offerBiometricNow = true }: { onSignedIn: () => void; offerBiometricNow?: boolean }) {
  const dark = useColorScheme() !== 'light';
  const c = dark ? DARK : LIGHT;
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const passwordRef = useRef<ComponentRef<typeof TextInput>>(null);

  const refreshVault = useCallback(async () => { setName(await vault.biometryName()); setSaved(await vault.hasSaved()); }, []);

  const attempt = useCallback(async (id: string, pw: string, fromSaved: boolean) => {
    setWorking(true); setError('');
    const result = await signIn(id, pw);
    setWorking(false);
    if (result.kind === 'signedIn' || result.kind === 'needsPasswordSetup') return true;     // a setup session opens the same way
    if (result.kind === 'offline') { setError('Couldn’t reach the server. Check your connection and try again.'); return false; }
    if (fromSaved && result.wrongPassword) {
      await vault.clear(); await refreshVault();
      setError('Your saved sign-in is out of date. Sign in with your password to set it up again.');
    } else setError(result.message);
    return false;
  }, [refreshVault]);

  const useBiometrics = useCallback(async () => {
    if (working) return;
    const label = (await vault.biometryName()) || 'biometrics';
    const credentials = await vault.load(`Sign in to Easy Surfaces with ${label}`);
    if (credentials && (await attempt(credentials.identifier, credentials.password, true))) onSignedIn();
  }, [attempt, onSignedIn, working]);

  useEffect(() => {
    void (async () => {
      await refreshVault();
      if (offerBiometricNow && (await vault.hasSaved())) void useBiometrics();
    })();
    // once, when the screen opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canSubmit = Boolean(identifier.trim()) && Boolean(password);
  const submit = async () => {
    const id = identifier.trim();
    if (!canSubmit || working) return;
    if (!(await attempt(id, password, false))) return;
    const label = await vault.biometryName();
    if (label) {
      if (await vault.hasSaved()) await vault.save(id, password);            // keep it current
      else {
        const yes = await new Promise<boolean>((resolve) => Alert.alert(`Use ${label} next time?`,
          'Sign in faster without typing your password. You can turn it off any time with “Use a different account”.',
          [{ text: 'Not now', style: 'cancel', onPress: () => resolve(false) }, { text: `Use ${label}`, onPress: () => resolve(true) }]));
        if (yes) await vault.save(id, password);
      }
    }
    onSignedIn();
  };

  const device = Platform.OS === 'ios' ? 'iPhone' : 'phone';
  const footer = error ? 'Five wrong passwords lock the account for 15 minutes.'
    : name && saved ? `${name} unlocks the sign-in saved on this ${device}. It never leaves the device.`
    : 'Forgot your password? Ask your manager to reset it in Users & Roles.';

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <ImageBackground source={dark ? require('../../assets/slab-dark.jpg') : require('../../assets/slab-light.jpg')} style={StyleSheet.absoluteFill} resizeMode="cover" />
      <LinearGradient colors={c.gradient} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
          <View style={styles.column}>
            <View style={styles.header}>
              <Image source={require('../../assets/login-mark.png')} style={styles.mark} resizeMode="contain" accessibilityIgnoresInvertColors />
              <Text accessibilityRole="header" style={[styles.title, { color: c.ink }]}>EASY SURFACES</Text>
            </View>

            <View style={styles.fields}>
              <View style={[styles.field, { backgroundColor: c.field, borderColor: c.edge }]}>
                <UserIcon color={c.icon} />
                <TextInput value={identifier} onChangeText={setIdentifier} placeholder="Email or username" placeholderTextColor={c.placeholder}
                  autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="username" autoComplete="username"
                  returnKeyType="next" onSubmitEditing={() => passwordRef.current?.focus()} editable={!working}
                  accessibilityLabel="Email or username" style={[styles.input, { color: c.ink }]} />
              </View>
              <View style={[styles.field, { backgroundColor: c.field, borderColor: error ? c.error : c.edge, borderWidth: error ? 1.5 : 1 }]}>
                <LockIcon color={error ? c.error : c.icon} />
                <TextInput ref={passwordRef} value={password} onChangeText={setPassword} placeholder="Password" placeholderTextColor={c.placeholder}
                  secureTextEntry={!show} autoCapitalize="none" autoCorrect={false} textContentType="password" autoComplete="password"
                  returnKeyType="go" onSubmitEditing={() => void submit()} editable={!working}
                  accessibilityLabel="Password" style={[styles.input, { color: c.ink }]} />
                <Pressable onPress={() => setShow((v) => !v)} accessibilityRole="button" accessibilityLabel={show ? 'Hide password' : 'Show password'} style={styles.eye}>
                  <EyeIcon color={c.eye} off={show} />
                </Pressable>
              </View>
            </View>

            {error ? (
              <View accessibilityRole="alert" style={styles.error}>
                <AlertIcon color={c.errorText} />
                <Text style={[styles.errorText, { color: c.errorText }]}>{error}</Text>
              </View>
            ) : null}

            <Pressable onPress={() => void submit()} disabled={!canSubmit || working} accessibilityRole="button" accessibilityLabel={working ? 'Signing in' : 'Sign in'}
              style={[styles.primary, { backgroundColor: C_GOLD, opacity: canSubmit || working ? 1 : 0.4 }]}>
              {working ? <ActivityIndicator color="#000000" /> : <Text style={styles.primaryText}>Sign in</Text>}
            </Pressable>

            {name && saved ? (
              <>
                <View style={styles.or} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  <View style={[styles.rule, { backgroundColor: c.rule }]} /><Text style={[styles.orText, { color: c.quiet }]}>or</Text><View style={[styles.rule, { backgroundColor: c.rule }]} />
                </View>
                <Pressable onPress={() => void useBiometrics()} disabled={working} accessibilityRole="button" style={[styles.secondary, { borderColor: C_GOLD }]}>
                  <FaceIcon color={c.goldText} />
                  <Text style={[styles.secondaryText, { color: c.goldText }]}>Sign in with {name}</Text>
                </Pressable>
                <Pressable onPress={() => { void vault.clear().then(refreshVault); }} accessibilityRole="button" style={styles.link}>
                  <Text style={{ color: c.link, fontSize: 14 }}>Use a different account</Text>
                </Pressable>
              </>
            ) : null}

            <View style={styles.spacer} />
            <Text style={[styles.footer, { color: c.quiet }]}>{footer}</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/* The artifact's own icons (22px, 1.7 stroke), so the screen matches it exactly. */
const Icon = ({ color, children, size = 22, stroke = 1.7 }: { color: string; children: React.ReactNode; size?: number; stroke?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">{children}</Svg>
);
const UserIcon = ({ color }: { color: string }) => <Icon color={color}><Circle cx="12" cy="8" r="4" /><Path d="M4 20c1-4 4-6 8-6s7 2 8 6" /></Icon>;
const LockIcon = ({ color }: { color: string }) => <Icon color={color}><Rect x="5" y="11" width="14" height="9" rx="2" /><Path d="M8 11V8a4 4 0 0 1 8 0v3" /></Icon>;
const EyeIcon = ({ color, off }: { color: string; off: boolean }) => (
  <Icon color={color}><Path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><Circle cx="12" cy="12" r="3" />{off ? <Path d="M3 3l18 18" /> : null}</Icon>
);
const AlertIcon = ({ color }: { color: string }) => <Icon color={color} size={18} stroke={2}><Circle cx="12" cy="12" r="9" /><Path d="M12 7v6M12 16.5v.5" /></Icon>;
const FaceIcon = ({ color }: { color: string }) => (
  <Icon color={color} size={24}><Path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" /><Path d="M9 9.5v1.5M15 9.5v1.5M12 9.5v3.5h-1M9 16c1.7 1.4 4.3 1.4 6 0" /></Icon>
);

const C_GOLD = '#c9a24b';
const DARK = {
  bg: '#000000', gradient: ['rgba(0,0,0,0.30)', 'rgba(0,0,0,0.62)', 'rgba(0,0,0,0.82)'] as const,
  ink: '#ffffff', quiet: '#8e8e93', placeholder: '#8e8e93', icon: '#8e8e93', eye: '#a1a1a6', link: '#a1a1a6', rule: '#2c2c2e',
  field: '#1c1c1e', edge: 'transparent', error: '#ff6b61', errorText: '#ff8a80', goldText: '#c9a24b'
};
const LIGHT = {
  bg: '#f5f5f7', gradient: ['rgba(255,255,255,0.35)', 'rgba(255,255,255,0.72)', 'rgba(255,255,255,0.90)'] as const,
  ink: '#1c1c1e', quiet: '#6e6e73', placeholder: '#6e6e73', icon: '#6e6e73', eye: '#5f5f64', link: '#6e6e73', rule: '#d1d1d6',
  field: '#ffffff', edge: '#d1d1d6', error: '#c62828', errorText: '#c62828', goldText: '#8a6a1c'
};
const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  scroll: { flexGrow: 1 },
  column: { flexGrow: 1, width: '100%', maxWidth: 440, alignSelf: 'center', paddingHorizontal: 24 },
  header: { marginTop: 150, alignItems: 'center', gap: 14 },
  mark: { width: 40, height: 52 },
  title: { fontSize: 24, fontWeight: '600', letterSpacing: 4 },
  fields: { marginTop: 44, gap: 14 },
  field: { height: 52, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1 },
  input: { flex: 1, minWidth: 0, height: '100%', fontSize: 17, padding: 0 },
  eye: { width: 44, height: 44, marginRight: -10, alignItems: 'center', justifyContent: 'center' },
  error: { marginTop: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  errorText: { flex: 1, fontSize: 14, lineHeight: 20 },
  primary: { marginTop: 22, height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontSize: 17, fontWeight: '600', color: '#000000' },
  or: { marginTop: 28, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rule: { flex: 1, height: 1 },
  orText: { fontSize: 13 },
  secondary: { marginTop: 22, height: 52, borderRadius: 12, borderWidth: 1.5, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  secondaryText: { fontSize: 17, fontWeight: '600' },
  link: { marginTop: 6, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  spacer: { flexGrow: 1, minHeight: 36 },
  footer: { textAlign: 'center', fontSize: 13, lineHeight: 18, marginBottom: 44 }
});
