import { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { dictationErrorText, speechRecognitionCtor } from '../../../utils/dictation';
import './DictationButton.css';

/*
 * A mic for a text box: tap, talk, and the words are added to the box; tap
 * again to stop. Uses the browser's own speech recognition (free, nothing is
 * sent to our server), so it is absent where the browser has none. Only
 * finished phrases are added, so what is typed is never rewritten under the
 * rep's cursor. Sits at the bottom right of a `.dictate-wrap`.
 */
export default function DictationButton({ onText, label = 'Speak instead of typing', disabled = false }: {
    onText: (spoken: string) => void;
    label?: string;
    disabled?: boolean;
}) {
    const Ctor = speechRecognitionCtor();
    const [listening, setListening] = useState(false);
    const [problem, setProblem] = useState('');
    const recognition = useRef<InstanceType<NonNullable<typeof Ctor>> | null>(null);
    const onTextRef = useRef(onText);
    onTextRef.current = onText;

    // Closing the form while listening must switch the microphone off.
    useEffect(() => () => { recognition.current?.abort(); }, []);

    if (!Ctor) return null;

    const stop = () => recognition.current?.stop();

    const start = () => {
        setProblem('');
        const r = new Ctor();
        r.lang = navigator.language || 'en-US';
        r.continuous = true;
        r.interimResults = false;
        r.onresult = (e) => {
            for (let i = e.resultIndex; i < e.results.length; i++) {
                const result = e.results[i];
                if (result.isFinal) onTextRef.current(result[0].transcript);
            }
        };
        r.onerror = (e) => setProblem(dictationErrorText(e.error));
        r.onend = () => {
            setListening(false);
            recognition.current = null;
        };
        recognition.current = r;
        try {
            r.start();
            setListening(true);
        } catch {
            // start() throws if it is already running.
            setListening(false);
        }
    };

    return (
        <>
            <button
                type="button"
                className={`dictate-btn${listening ? ' is-listening' : ''}`}
                aria-label={listening ? 'Stop listening' : label}
                aria-pressed={listening}
                title={listening ? 'Stop' : label}
                disabled={disabled}
                // Keep the text box's focus (and the keyboard) where it is.
                onMouseDown={(e) => e.preventDefault()}
                onClick={listening ? stop : start}
            >
                {listening ? <Square size={16} fill="currentColor" aria-hidden="true" /> : <Mic size={18} aria-hidden="true" />}
            </button>
            {(listening || problem) && (
                <span className="dictate-status" data-tone={problem ? 'error' : undefined} aria-live="polite">
                    {problem || 'Listening… tap ■ when done'}
                </span>
            )}
        </>
    );
}
