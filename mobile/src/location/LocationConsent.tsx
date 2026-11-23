import { Fragment } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import { CONSENT_TITLE, consentBody, platformWords } from '../../../src/features/locationCollector/collectorRules';
import { useLocationConsent } from './useLocationConsent';

const palette = (dark: boolean) => dark
  ? {
    bg: '#14130f', ink: '#efeadf', muted: '#a39c8b', btn: '#efeadf', btnInk: '#14130f', warn: '#3b211b', warnInk: '#e5826b',
    tile: '#3a2f17', tileInk: '#e2b04a', box: '#1f1d18', boxEdge: '#3a362d', lead: '#c9c2b2', badge: '#b8892b', pill: '#3a3a3c', danger: '#ff8a7a',
    card: '#2a2112', cardEdge: '#5a4520', cardTile: '#3d2f12', cardIcon: '#e2b04a', cardTitle: '#f3e2bd', cardBody: '#d9c08e',
    path: '#1f1a10', pathEdge: '#4a3a1c', pathInk: '#f3e2bd', chevron: '#c79a45', chip: '#e2b04a', chipInk: '#1d1b16',
    laterEdge: '#6b5528', laterInk: '#f3e2bd', go: '#e2b04a', goInk: '#1d1b16', close: '#d9c08e'
  }
  : {
    bg: '#ffffff', ink: '#1d1b16', muted: '#6d675b', btn: '#1d1b16', btnInk: '#ffffff', warn: '#f7e0da', warnInk: '#b4472f',
    tile: '#f5ecd9', tileInk: '#8a6416', box: '#fbf9f4', boxEdge: '#e7e1d4', lead: '#4a453b', badge: '#b8892b', pill: '#3a3a3c', danger: '#b42318',
    card: '#fff8ea', cardEdge: '#efd9a7', cardTile: '#f6e2b5', cardIcon: '#7a4f00', cardTitle: '#4a3104', cardBody: '#6b4a0c',
    path: '#ffffff', pathEdge: '#f0e3c4', pathInk: '#4a3104', chevron: '#a07a2c', chip: '#7a4f00', chipInk: '#ffffff',
    laterEdge: '#e3c98c', laterInk: '#5c3d06', go: '#7a4f00', goInk: '#ffffff', close: '#7a5a1c'
  };

/**
 * The location screens the phone draws itself (the website draws none inside the app), over the website: the agreement a tracked
 * person sees once per wording version (owner's design 2026-11-23: "Easy Surfaces requires location", and on iPhone the two buttons
 * to tap), a banner when location is off for the app, and a card when it isn't on Always.
 */
export default function LocationConsent({ active }: { active: boolean }) {
  const { needsConsent, denied, askAlways, dismissAlways, saving, error, allow } = useLocationConsent(active);
  const c = palette(useColorScheme() === 'dark');
  const insets = useSafeAreaInsets();
  const platform = Platform.OS === 'android' ? 'android' : 'ios';
  const words = platformWords(platform);

  if (needsConsent) {
    return (
      <SafeAreaView style={[styles.full, { backgroundColor: c.bg }]} accessibilityViewIsModal>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={[styles.tile, { backgroundColor: c.tile }]}>
            <Svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke={c.tileInk} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <Path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z" /><Circle cx="12" cy="10" r="2.6" />
            </Svg>
          </View>
          <Text style={[styles.title, { color: c.ink }]} accessibilityRole="header">{CONSENT_TITLE}</Text>
          <Text style={[styles.body, { color: c.ink }]}>{consentBody(platform)}</Text>
          {words.steps ? (
            <View style={[styles.box, { backgroundColor: c.box, borderColor: c.boxEdge }]}>
              <Text style={[styles.boxHeading, { color: c.ink }]}>{words.steps.heading}</Text>
              {words.steps.items.map((step, i) => (
                <View key={step.button} style={styles.step}>
                  <View style={[styles.badge, { backgroundColor: c.badge }]}><Text style={styles.badgeText}>{i + 1}</Text></View>
                  <View style={styles.stepText}>
                    <Text style={[styles.lead, { color: c.lead }]}>{step.lead}</Text>
                    <View style={[styles.pill, { backgroundColor: c.pill }]}><Text style={styles.pillText}>{step.button}</Text></View>
                  </View>
                </View>
              ))}
              <Text style={[styles.warning, { color: c.danger }]}>{words.steps.warning}</Text>
            </View>
          ) : <Text style={[styles.note, { color: c.muted }]}>{words.next}</Text>}
          {words.battery ? (
            <Text style={[styles.note, { color: c.muted }]}>
              {words.battery}{' '}
              <Text style={styles.link} onPress={() => { void Linking.sendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS').catch(() => Linking.openSettings()); }}>Open battery settings</Text>
            </Text>
          ) : null}
          {error ? <Text accessibilityRole="alert" style={[styles.error, { color: c.warnInk }]}>{error}</Text> : null}
        </ScrollView>
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

  if (askAlways) {
    const last = words.alwaysPath.length - 1;
    return (
      <View pointerEvents="box-none" style={[styles.bannerWrap, { top: insets.top + 6 }]}>
        <View accessibilityRole="alert" style={[styles.card, { backgroundColor: c.card, borderColor: c.cardEdge }]}>
          <View style={styles.cardHead}>
            <View style={[styles.cardTile, { backgroundColor: c.cardTile }]}>
              <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={c.cardIcon} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <Path d="M21 3 3 10.5l7.5 2.6L13.5 21z" />
              </Svg>
            </View>
            <View style={styles.cardText}>
              <Text style={[styles.cardTitle, { color: c.cardTitle }]}>{words.alwaysTitle}</Text>
              <Text style={[styles.cardBody, { color: c.cardBody }]}>{words.alwaysBody}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Remind me later" onPress={dismissAlways} style={styles.close}>
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={c.close} strokeWidth={2} strokeLinecap="round"><Path d="M6 6l12 12M18 6 6 18" /></Svg>
            </Pressable>
          </View>
          <View style={[styles.path, { backgroundColor: c.path, borderColor: c.pathEdge }]}>
            {words.alwaysPath.map((part, i) => (
              <Fragment key={part}>
                {i === last
                  ? <View style={[styles.chip, { backgroundColor: c.chip }]}><Text style={[styles.chipText, { color: c.chipInk }]}>{part}</Text></View>
                  : <Text style={[styles.pathText, { color: c.pathInk }]}>{part}</Text>}
                {i < last ? (
                  <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={c.chevron} strokeWidth={2.2} strokeLinecap="round"><Path d="m9 6 6 6-6 6" /></Svg>
                ) : null}
              </Fragment>
            ))}
          </View>
          <View style={styles.cardButtons}>
            <Pressable accessibilityRole="button" onPress={dismissAlways} style={[styles.cardBtn, styles.laterBtn, { borderColor: c.laterEdge }]}>
              <Text style={[styles.cardBtnText, { color: c.laterInk }]}>Later</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => { void Linking.openSettings(); }} style={[styles.cardBtn, { backgroundColor: c.go }]}>
              <Text style={[styles.cardBtnText, styles.strong, { color: c.goInk }]}>{words.settingsButton}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  full: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100 },
  content: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 48, paddingBottom: 16, gap: 16 },
  tile: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 26, fontWeight: '700', lineHeight: 32 },
  body: { fontSize: 17, lineHeight: 25 },
  box: { marginTop: 6, borderWidth: 1, borderRadius: 18, paddingVertical: 18, paddingHorizontal: 16, gap: 16 },
  boxHeading: { fontSize: 15, fontWeight: '700' },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  badge: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
  stepText: { flex: 1, gap: 8 },
  lead: { fontSize: 15, lineHeight: 20 },
  pill: { alignSelf: 'flex-start', borderRadius: 999, paddingVertical: 9, paddingHorizontal: 16 },
  pillText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
  warning: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  note: { fontSize: 14, lineHeight: 20 },
  link: { color: '#b8892b', fontWeight: '600' },
  error: { fontSize: 14, fontWeight: '600' },
  foot: { paddingHorizontal: 24, paddingBottom: 20, paddingTop: 8 },
  btn: { minHeight: 54, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 17, fontWeight: '700' },
  bannerWrap: { position: 'absolute', left: 12, right: 12, zIndex: 90 },
  banner: { borderRadius: 14, paddingVertical: 10, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  bannerText: { flex: 1, fontSize: 14, fontWeight: '600' },
  go: { borderRadius: 9, paddingVertical: 7, paddingHorizontal: 12 },
  goText: { fontSize: 13, fontWeight: '700' },
  card: { borderWidth: 1, borderRadius: 20, padding: 16, gap: 14, shadowColor: '#3c2800', shadowOpacity: 0.14, shadowRadius: 14, shadowOffset: { width: 0, height: 10 }, elevation: 6 },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  cardTile: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  cardText: { flex: 1, gap: 4 },
  cardTitle: { fontSize: 16, lineHeight: 21, fontWeight: '700' },
  cardBody: { fontSize: 14, lineHeight: 19 },
  close: { width: 44, height: 44, marginTop: -10, marginRight: -10, alignItems: 'center', justifyContent: 'center' },
  path: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1 },
  pathText: { fontSize: 13, fontWeight: '600' },
  chip: { borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10 },
  chipText: { fontSize: 13, fontWeight: '700' },
  cardButtons: { flexDirection: 'row', gap: 10 },
  cardBtn: { flex: 1, minHeight: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  laterBtn: { borderWidth: 1 },
  cardBtnText: { fontSize: 15, fontWeight: '600' },
  strong: { fontWeight: '700' }
});
