/**
 * What the phone has heard so far, shared by the speech test and the voice assistant (one rule, not two copies).
 * iOS reports speech in CHUNKS: after a pause it marks the chunk it was on as final and the next results start again from nothing (the
 * library's own docs: "you'll need to concatenate previous final results"). Showing only the newest report threw away everything before
 * the last pause, and an empty closing report wiped the lot (2026-11-28).
 * `committed` holds the finished chunks; `current` is the chunk still being spoken (it may be revised until it is final).
 */
export type HeardState = { committed: string; current: string };
export const emptyHeard: HeardState = { committed: '', current: '' };

const joinWords = (a: string, b: string): string => [a.trim(), b.trim()].filter(Boolean).join(' ');

/** Fold one report from the recognizer in. A report with no words changes nothing; a final one finishes the current chunk. */
export const addResult = (state: HeardState, transcript: string | undefined | null, isFinal: boolean): HeardState => {
  const words = (transcript || '').trim();
  if (!words) return state;
  return isFinal ? { committed: joinWords(state.committed, words), current: '' } : { committed: state.committed, current: words };
};

/** Everything heard so far, finished chunks first. */
export const heardText = (state: HeardState): string => joinWords(state.committed, state.current);
