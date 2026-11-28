import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Share, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { expoRecognizer, speechController } from '../speech/expoRecognizer';
import { type Attempt, reportText, scoreAttempt, summarize } from './scoring';
import { HINT_PHRASES, SENTENCES } from './script';

/**
 * A throw-away screen to measure how well THIS phone's speech recognizer hears our words. Open it with the link
 * easysurfaces://speech-test (type it in Notes and tap it). Read each sentence out loud, tap Done, and the screen scores what the
 * phone heard. Run the same sentences with hints off and on, and with on-device recognition off and on, then Share the results.
 * Nothing is sent anywhere: the words stay on this screen until Share is used.
 */
const GOLD = '#e5c04a';

export default function SpeechTestScreen({ onClose }: { onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'listening' | 'done'>('idle');
  const [hints, setHints] = useState(false);
  const [onDevice, setOnDevice] = useState(false);
  const [heard, setHeard] = useState('');
  const [problem, setProblem] = useState('');
  const [attempts, setAttempts] = useState<Attempt[]>([]);

  const onDeviceSupported = useMemo(() => { try { return expoRecognizer.supportsOnDevice(); } catch { return false; } }, []);
  const effectiveOnDevice = onDevice && onDeviceSupported;
  const sentence = SENTENCES[index];
  const config = `${hints ? 'hints' : 'no hints'} · ${effectiveOnDevice ? 'on-device' : 'Apple servers'}`;

  // The same listener the voice assistant uses (speech/core.ts): it joins the recognizer's chunks and keeps earlier words. The handlers
  // below run from its events, so what they read lives in refs (a closure would be out of date).
  const ctl = speechController();
  const stoppedAt = useRef(0);
  const settledAt = useRef(0);
  const finishing = useRef(false);
  const live = useRef({ sentence, config });
  live.current = { sentence, config };

  const finish = async () => {
    if (finishing.current) return;
    finishing.current = true;
    if (!stoppedAt.current) stoppedAt.current = Date.now();
    const { text } = await ctl.stop();
    const { sentence: s, config: c } = live.current;
    const attempt = scoreAttempt({
      id: s.id, config: c, expected: s.say, heard: text, terms: s.terms,
      settleMs: settledAt.current > stoppedAt.current ? settledAt.current - stoppedAt.current : undefined
    });
    setHeard(text);
    setAttempts((all) => [...all.filter((a) => !(a.id === s.id && a.config === c)), attempt]);
    setPhase('done');
  };

  useEffect(() => {
    const offPartial = ctl.on('partial', (e) => { setHeard(e.text); if (stoppedAt.current) settledAt.current = Date.now(); });
    const offError = ctl.on('error', (e) => {
      // The recognizer ended or the mic timed out on its own: score what was heard. "no-speech" is an ordinary ending.
      if (e.code === 'ended' || e.code === 'auto-stopped' || e.code === 'no-speech') { void finish(); return; }
      setProblem(`${e.code}: ${e.message}`);
      void finish();
    });
    return () => { offPartial(); offError(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = async () => {
    setProblem('');
    stoppedAt.current = 0; settledAt.current = 0; finishing.current = false;
    setHeard('');
    setPhase('listening');
    try {
      await ctl.start({ hints: hints ? HINT_PHRASES : [], onDevice: effectiveOnDevice });
    } catch (e) {
      setPhase('idle');
      const code = (e as { code?: string }).code;
      setProblem(code === 'not-allowed' ? 'Microphone or speech recognition is off for this app. Turn both on in Settings → Easy Surfaces.' : `${code || 'error'}: ${(e as Error).message}`);
    }
  };
  const done = () => { stoppedAt.current = Date.now(); void finish(); };
  const next = (by: number) => { setIndex((i) => Math.min(SENTENCES.length - 1, Math.max(0, i + by))); setPhase('idle'); setHeard(''); setProblem(''); };
  const close = () => { void ctl.abort(); onClose(); };

  const mine = attempts.find((a) => a.id === sentence.id && a.config === config);
  const summary = summarize(attempts);
  const share = () => void Share.share({
    message: reportText(attempts, { device: `${Platform.OS} ${Platform.Version}`, onDeviceSupported, when: new Date().toISOString().slice(0, 16).replace('T', ' ') })
  });

  return (
    <SafeAreaView style={s.root}>
      <View style={s.head}>
        <Text style={s.title}>Speech test</Text>
        <Pressable accessibilityLabel="Close" onPress={close} style={s.x}><Text style={s.xText}>✕</Text></Pressable>
      </View>
      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <View style={s.card}>
          <View style={s.row}><Text style={s.label}>Give the phone hints (our stone names and brands)</Text><Switch value={hints} onValueChange={setHints} disabled={phase === 'listening'} trackColor={{ true: GOLD }} /></View>
          <View style={s.row}>
            <Text style={s.label}>Keep audio on the phone (on-device){onDeviceSupported ? '' : ' — not supported here'}</Text>
            <Switch value={onDevice && onDeviceSupported} onValueChange={setOnDevice} disabled={phase === 'listening' || !onDeviceSupported} trackColor={{ true: GOLD }} />
          </View>
          <Text style={s.hint}>Now testing: {config}</Text>
        </View>

        <Text style={s.count}>Sentence {index + 1} of {SENTENCES.length}</Text>
        <Text style={s.say}>{sentence.say}</Text>

        {phase === 'idle' ? <Pressable onPress={() => void start()} style={s.primary}><Text style={s.primaryText}>Start — then read it out loud</Text></Pressable> : null}
        {phase === 'listening' ? <Pressable onPress={done} style={s.primary}><Text style={s.primaryText}>Done talking</Text></Pressable> : null}
        {phase === 'done' ? <Pressable onPress={() => { setPhase('idle'); setHeard(''); }} style={s.secondary}><Text style={s.secondaryText}>Try this one again</Text></Pressable> : null}

        <Text style={s.heardLabel}>{phase === 'listening' ? 'Listening…' : 'The phone heard'}</Text>
        <Text style={s.heard}>{heard || ' '}</Text>
        {problem ? <Text style={s.problem}>{problem}</Text> : null}

        {phase === 'done' && mine ? (
          <View style={s.card}>
            <Text style={s.score}>Word errors {Math.round(mine.wer * 100)}%{mine.settleMs != null ? ` · final words ${(mine.settleMs / 1000).toFixed(1)} s after Done` : ''}</Text>
            {mine.terms.map((t) => (
              <Text key={t.term} style={[s.term, t.state === 'exact' ? s.ok : t.state === 'close' ? s.near : s.bad]}>
                {t.state === 'exact' ? '✓' : t.state === 'close' ? '≈' : '✗'} {t.term}{t.state !== 'exact' && t.heardAs ? `  →  heard "${t.heardAs}"` : ''}
              </Text>
            ))}
          </View>
        ) : null}

        <View style={s.row}>
          <Pressable onPress={() => next(-1)} disabled={index === 0 || phase === 'listening'} style={[s.nav, (index === 0 || phase === 'listening') && s.dim]}><Text style={s.navText}>‹ Back</Text></Pressable>
          <Pressable onPress={() => next(1)} disabled={index === SENTENCES.length - 1 || phase === 'listening'} style={[s.nav, (index === SENTENCES.length - 1 || phase === 'listening') && s.dim]}><Text style={s.navText}>Next ›</Text></Pressable>
        </View>

        {summary.length ? (
          <View style={s.card}>
            <Text style={s.score}>So far</Text>
            {summary.map((x) => (
              <Text key={x.config} style={s.sum}>
                {x.config}: {x.sentences} read · word errors {Math.round(x.avgWer * 100)}% · hard words ✓ {x.exact} ≈ {x.close} ✗ {x.missed}
              </Text>
            ))}
            <Pressable onPress={share} style={s.secondary}><Text style={s.secondaryText}>Share results</Text></Pressable>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f0e0c' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12 },
  title: { color: '#f2efe6', fontSize: 20, fontWeight: '700' },
  x: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: '#34322d', alignItems: 'center', justifyContent: 'center' },
  xText: { color: '#f2efe6', fontSize: 16 },
  body: { paddingHorizontal: 20, paddingBottom: 60, gap: 14 },
  card: { backgroundColor: '#1c1b19', borderWidth: 1, borderColor: '#34322d', borderRadius: 16, padding: 14, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  label: { color: '#f2efe6', fontSize: 14, flex: 1 },
  hint: { color: '#a8a398', fontSize: 12 },
  count: { color: '#a8a398', fontSize: 13, fontWeight: '600', marginTop: 4 },
  say: { color: GOLD, fontSize: 24, lineHeight: 32, fontWeight: '700' },
  primary: { height: 54, borderRadius: 14, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#1a1405', fontSize: 16, fontWeight: '700' },
  secondary: { height: 48, borderRadius: 14, borderWidth: 1, borderColor: '#34322d', alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: '#f2efe6', fontSize: 15, fontWeight: '600' },
  heardLabel: { color: '#a8a398', fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  heard: { color: '#f2efe6', fontSize: 18, lineHeight: 26, minHeight: 56 },
  problem: { color: '#e5736a', fontSize: 13 },
  score: { color: '#f2efe6', fontSize: 14, fontWeight: '700' },
  term: { fontSize: 14 },
  ok: { color: '#7bc67e' },
  near: { color: GOLD },
  bad: { color: '#e5736a' },
  sum: { color: '#cfcabd', fontSize: 13 },
  nav: { flex: 1, height: 46, borderRadius: 12, borderWidth: 1, borderColor: '#34322d', alignItems: 'center', justifyContent: 'center' },
  navText: { color: '#f2efe6', fontSize: 15, fontWeight: '600' },
  dim: { opacity: 0.35 }
});
