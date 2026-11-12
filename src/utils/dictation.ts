/*
 * Voice-to-text rules for the visit form's text boxes (pure, tested).
 * The browser's speech recognition hands back phrases; this decides how a
 * phrase joins what is already typed.
 */

/** Add a spoken phrase to the text already in the box. */
export function appendSpoken(existing: string, spoken: string): string {
    const phrase = spoken.trim().replace(/\s+/g, ' ');
    if (!phrase) return existing;
    if (!existing.trim()) return capitalizeFirst(phrase);
    const base = existing.replace(/\s+$/, '');
    // Start a new sentence when the text so far ended one.
    const next = /[.!?]$/.test(base) ? capitalizeFirst(phrase) : phrase;
    return `${base} ${next}`;
}

function capitalizeFirst(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The words a phone gives for an error, or '' when it needs no message. */
export function dictationErrorText(code: string): string {
    switch (code) {
        case 'not-allowed':
        case 'service-not-allowed':
            return 'Microphone is blocked. Allow it in the browser settings.';
        case 'no-speech':
            return "Didn't hear anything. Try again.";
        case 'audio-capture':
            return 'No microphone found.';
        case 'network':
            return 'No connection. Voice needs signal.';
        case 'aborted':
            return '';
        default:
            return "Couldn't hear that. Try again.";
    }
}

type RecognitionCtor = new () => {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
    onerror: ((e: { error: string }) => void) | null;
    onend: (() => void) | null;
    start: () => void;
    stop: () => void;
    abort: () => void;
};

/** The browser's speech recognition, or null when it has none. */
export function speechRecognitionCtor(w: unknown = typeof window === 'undefined' ? undefined : window): RecognitionCtor | null {
    const win = w as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor } | undefined;
    return win?.SpeechRecognition || win?.webkitSpeechRecognition || null;
}
