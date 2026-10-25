/**
 * The old "Import from Excel" window's own rules (CustomerImportModal.tsx):
 * its tab names, the upload it posts, how a failure is worded, and the
 * review list's CSV. The plan itself is the server's (src/utils/customerImport.js).
 */
import type { Loose } from '../../../types/records';
import { csvCell } from './importFields';

export const ACTION_LABELS: Record<string, string> = {
    create: 'New customers',
    update: 'Will be updated',
    review: 'Needs your review',
    error: 'Could not be read'
};

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A copy of `map` with `key` set to `value`, or dropped when `value` is blank. */
export const withEntry = (map: Record<string, string>, key: string | number, value: string) => {
    const next = { ...map };
    if (value) next[key] = value; else delete next[key];
    return next;
};

/**
 * The upload both the preview and the apply send: the file, plus each answer
 * the person has given (only the ones they have, so an untouched import posts
 * nothing but the file). The server re-plans from exactly this.
 */
export const importForm = (file: File, answers: Record<string, Record<string, unknown>>) => {
    const body = new FormData();
    body.append('file', file);
    for (const [name, value] of Object.entries(answers)) {
        if (Object.keys(value).length) body.append(name, JSON.stringify(value));
    }
    return body;
};

/**
 * Whatever the server said went wrong, in words.
 *
 * Only these two routes answer with `message`. The auth middleware says `error`,
 * and so does the API's catch-all 404 — which also carries a `hint` naming the
 * likeliest cause, the single most useful sentence in the whole response.
 * Reading only `message` threw all of that away and showed a bare "Preview
 * failed", which sent us looking in the wrong place for an afternoon. Read every
 * field the server actually uses, and always show the status code.
 */
export const describeFailure = async (res: Response): Promise<string> => {
    const body = await res.text();
    let parsed: Loose | null = null;
    try { parsed = JSON.parse(body); } catch { /* not JSON — fall through */ }

    const said = parsed && (parsed.message || parsed.error);
    if (said) return `${said}${parsed!.hint ? ` — ${parsed!.hint}` : ''} (HTTP ${res.status})`;

    return `HTTP ${res.status} — ${(body || '').trim().slice(0, 200) || res.statusText || 'no response body'}`;
};

/** The rows flagged for review, one line per possible match, as a CSV. */
export const reviewCsvText = (rows: Loose[]) => {
    const lines = [
        ['Sheet row', 'Company', 'Contact', 'Email', 'Phone', 'City', 'Why', 'Existing match', 'Matched on', 'Confidence'].join(',')
    ];
    for (const r of rows.filter(row => row.action === 'review')) {
        for (const m of (r.matches || [])) {
            lines.push([
                r.rowNumber, r.company, r.contactName, r.email, r.phone, r.city,
                r.reason, m.label, m.signals.join(' + '), m.score
            ].map(csvCell).join(','));
        }
    }
    return lines.join('\n');
};
