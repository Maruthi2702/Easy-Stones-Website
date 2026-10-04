import React, { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';

const copyText = async (text) => {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        return false;
    }
};

/** Copy to clipboard, with a moment of "✓ Copied". */
export default function CopyButton({ text, label = 'Copy' }) {
    const [done, setDone] = useState(false);
    useEffect(() => {
        if (!done) return;
        const t = setTimeout(() => setDone(false), 1600);
        return () => clearTimeout(t);
    }, [done]);
    return (
        <button type="button" className="fm-btn" onClick={async () => setDone(await copyText(text))} aria-live="polite">
            {done ? <><Check size={16} className="up-copy-done" aria-hidden="true" />Copied</> : <><Copy size={16} aria-hidden="true" />{label}</>}
        </button>
    );
}
