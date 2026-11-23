import { AppState, Keyboard, Linking } from 'react-native';
import * as Application from 'expo-application';
import type { PluginImpl } from '../protocol';

/** @capacitor/app: version info, foreground / background, and links that open the app. */
export const App: PluginImpl = {
  calls: {
    getInfo: () => ({ name: 'Easy Surfaces', id: Application.applicationId || 'app.easysurfaces', build: Application.nativeBuildVersion || '', version: Application.nativeApplicationVersion || '' }),
    getState: () => ({ isActive: AppState.currentState === 'active' }),
    getLaunchUrl: async () => { const url = await Linking.getInitialURL(); return url ? { url } : {}; }
  },
  callbacks: {},
  events: {
    appStateChange: (emit) => { const s = AppState.addEventListener('change', (st) => emit({ isActive: st === 'active' })); return () => s.remove(); },
    appUrlOpen: (emit) => { const s = Linking.addEventListener('url', ({ url }) => emit({ url })); return () => s.remove(); }
  }
};

/**
 * @capacitor/keyboard: the website adds its own padding from `keyboardHeight` (the app told it the keyboard resize is "none"), so the
 * native side must not also resize the page; the heights come from React Native's own keyboard events.
 */
export const KeyboardPlugin: PluginImpl = {
  calls: { setStyle: () => ({}), setAccessoryBarVisible: () => ({}), hide: () => { Keyboard.dismiss(); return {}; } },
  callbacks: {},
  events: {
    keyboardDidShow: (emit) => { const s = Keyboard.addListener('keyboardDidShow', (e) => emit({ keyboardHeight: e.endCoordinates.height })); return () => s.remove(); },
    keyboardDidHide: (emit) => { const s = Keyboard.addListener('keyboardDidHide', () => emit({})); return () => s.remove(); },
    keyboardWillShow: (emit) => { const s = Keyboard.addListener('keyboardWillShow', (e) => emit({ keyboardHeight: e.endCoordinates.height })); return () => s.remove(); },
    keyboardWillHide: (emit) => { const s = Keyboard.addListener('keyboardWillHide', () => emit({})); return () => s.remove(); }
  }
};
