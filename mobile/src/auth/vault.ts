import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * The saved sign-in behind Face ID / fingerprint (the iPhone app's CredentialVault.swift). The password sits in the secure store
 * behind biometrics: reading it is what shows the prompt. The account name is kept beside it in plain form so the app can tell
 * "a sign-in is saved" at launch WITHOUT showing the prompt.
 */
const PASSWORD_KEY = 'easysurfaces.signin.password';
const ACCOUNT_KEY = 'easysurfaces.signin.account';
const SECURE = { requireAuthentication: true, keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY } as const;

/** "Face ID", "Touch ID", "Fingerprint", "Face unlock", or null when this phone can't use biometrics (or none is enrolled). */
export async function biometryName(): Promise<string | null> {
  try {
    if (!(await LocalAuthentication.hasHardwareAsync()) || !(await LocalAuthentication.isEnrolledAsync())) return null;
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    const face = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
    const finger = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
    if (Platform.OS === 'ios') return face ? 'Face ID' : finger ? 'Touch ID' : null;
    return finger ? 'Fingerprint' : face ? 'Face unlock' : null;
  } catch { return null; }
}

export async function hasSaved(): Promise<boolean> {
  try { return Boolean(await SecureStore.getItemAsync(ACCOUNT_KEY)); } catch { return false; }
}

export async function save(identifier: string, password: string): Promise<boolean> {
  try {
    await clear();
    if (!(await biometryName())) return false;
    await SecureStore.setItemAsync(PASSWORD_KEY, password, SECURE);
    await SecureStore.setItemAsync(ACCOUNT_KEY, identifier);
    return true;
  } catch { await clear(); return false; }
}

/** Shows the biometric prompt and returns the saved sign-in, or null when the person cancels, fails, or nothing is saved. */
export async function load(reason: string): Promise<{ identifier: string; password: string } | null> {
  try {
    const identifier = await SecureStore.getItemAsync(ACCOUNT_KEY);
    if (!identifier) return null;
    const password = await SecureStore.getItemAsync(PASSWORD_KEY, { ...SECURE, authenticationPrompt: reason });
    return password ? { identifier, password } : null;
  } catch { return null; }
}

export async function clear(): Promise<void> {
  try { await SecureStore.deleteItemAsync(PASSWORD_KEY); } catch { /* nothing saved */ }
  try { await SecureStore.deleteItemAsync(ACCOUNT_KEY); } catch { /* nothing saved */ }
}
