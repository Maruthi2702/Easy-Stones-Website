import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { consentBody, platformWords } from '../../../src/features/locationCollector/collectorRules';
import { useLocationConsent } from './useLocationConsent';

const palette = (dark: boolean) => dark
  ? { bg: '#14130f', ink: '#efeadf', muted: '#a39c8b', btn: '#efeadf', btnInk: '#14130f', warn: '#3b211b', warnInk: '#e5826b' }
  : { bg: '#ffffff', ink: '#1d1b16', muted: '#6d675b', btn: '#1d1b16', btnInk: '#ffffff', warn: '#f7e0da', warnInk: '#b4472f' };

/**
 * The two location screens the phone draws itself (the website draws neither inside the app): the one-paragraph agreement a tracked
 * person sees once per wording version, and a banner when location is turned off for the app. Rendered over the website.
 */
export default function LocationConsent({ active }: { active: boolean }) {
  const { needsConsent, denied, saving, error, allow } = useLocationConsent(active);
  const c = palette(useColorScheme() === 'dark');
  const insets = useSafeAreaInsets();
  const platform = Platform.OS === 'android' ? 'android' : 'ios';
  const words = platformWords(platform);

  if (needsConsent) {
    return (
      <SafeAreaView style={[styles.full, { backgroundColor: c.bg }]} accessibilityViewIsModal>
        <View style={styles.content}>
          <Text style={[styles.title, { color: c.ink }]} accessibilityRole="header">Share your location during work hours</Text>
          <Text style={[styles.body, { color: c.ink }]}>{consentBody(platform)}</Text>
          <Text style={[styles.note, { color: c.muted }]}>{words.next}</Text>
          {words.battery ? (
            <Text style={[styles.note, { color: c.muted }]}>
              {words.battery}{' '}
              <Text style={styles.link} onPress={() => { void Linking.sendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS').catch(() => Linking.openSettings()); }}>Open battery settings</Text>
            </Text>
          ) : null}
          {error ? <Text accessibilityRole="alert" style={[styles.error, { color: c.warnInk }]}>{error}</Text> : null}
        </View>
        <View style={styles.foot}>
          <Pressable accessibilityRole="button" accessibilityLabel="Allow" disabled={saving} onPress={() => { void allow(); }} style={[styles.btn, { backgroundColor: c.btn, opacity: saving ? 0.7 : 1 }]}>
            {saving ? <ActivityIndicator color={c.btnInk} /> : <Text style={[styles.btnText, { color: c.btnInk }]}>Allow</Text>}
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (denied) {
    return (
      <View pointerEvents="box-none" style={[styles.bannerWrap, { top: insets.top + 6 }]}>
        <View accessibilityRole="alert" style={[styles.banner, { backgroundColor: c.warn }]}>
          <Text style={[styles.bannerText, { color: c.warnInk }]}>Location is off for Easy Surfaces.</Text>
          <Pressable accessibilityRole="button" onPress={() => { void Linking.openSettings(); }} style={[styles.go, { backgroundColor: c.warnInk }]}>
            <Text style={[styles.goText, { color: c.bg }]}>{words.settingsButton}</Text>
          </Pressable>
        </View>
      </View>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  full: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100 },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 48, gap: 14 },
  title: { fontSize: 24, fontWeight: '700', lineHeight: 30 },
  body: { fontSize: 18, lineHeight: 26 },
  note: { fontSize: 14, lineHeight: 20 },
  link: { color: '#b8892b', fontWeight: '600' },
  error: { fontSize: 14, fontWeight: '600' },
  foot: { paddingHorizontal: 24, paddingBottom: 20 },
  btn: { minHeight: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 17, fontWeight: '700' },
  bannerWrap: { position: 'absolute', left: 12, right: 12, zIndex: 90 },
  banner: { borderRadius: 14, paddingVertical: 10, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  bannerText: { flex: 1, fontSize: 14, fontWeight: '600' },
  go: { borderRadius: 9, paddingVertical: 7, paddingHorizontal: 12 },
  goText: { fontSize: 13, fontWeight: '700' }
});
