/**
 * The SPS import window's own rules (SpsImportModal.tsx): field and match
 * wording, the review tabs, which button each step's footer shows, and the
 * plan's CSV. What an import does is the server's (src/utils/spsImportPlan.ts).
 */
import type { Loose } from '../../../types/records';
import { FIELD_LABELS, csvCell } from './importFields';

export const STEPS = ['Upload', 'Columns & names', 'Review', 'Import', 'Results'];

/** A field's name in words; one no list names is split at its capitals. */
export const fieldName = (f: string) => FIELD_LABELS[f] || f.replace(/([A-Z])/g, ' $1').toLowerCase();

/** Why a look-alike was offered, in words. */
export const SIGNAL_WORDS: Record<string, string> = { phone: 'same phone', email: 'same email', 'company name': 'similar name', 'email domain': 'same email domain', 'exact name': 'same name' };

/** A count as shown (a missing one is 0). */
export const n = (v: unknown) => Number(v || 0).toLocaleString();

/** A date and time as shown in the history and the results. */
export const when = (d: string | number | Date | null | undefined) =>
    (d ? new Date(d).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

/** "Seattle, WA 98101" from the parts that exist. */
export const placeOf = (city?: string, state?: string, zip?: string): string => [city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');

/** The result numbers on step 5 and in the history: key, then its words. */
export const RESULT_TILES: [string, string][] = [['added', 'added'], ['updated', 'updated'], ['restored', 'brought back'], ['keptDeleted', 'kept deleted'], ['unchanged', 'no changes'], ['failed', 'failed']];

/** One run's customer, as its pill says. */
export const resultLabel = (i: Loose) =>
    ({ added: 'Added', updated: i.connect ? 'Connected' : 'Updated', restored: 'Brought back', keptDeleted: 'Kept deleted', unchanged: 'No changes', failed: 'Failed' } as Record<string, string>)[i.result] || i.result;

/** The pill's colour for one run's customer. */
export const resultTone = (result: string) =>
    (result === 'added' ? 'new' : result === 'updated' || result === 'restored' ? 'upd' : result === 'failed' ? 'bad' : '');

/**
 * Step 3's tabs: key, label, count. A tab with nothing in it is left out,
 * except "Need a decision" and "New", which always show.
 */
export const reviewTabs = (counts: Loose): [string, string, number][] => ([
    ['decision', 'Need a decision', counts.decision], ['deleted', 'Deleted before', counts.deleted],
    ['new', 'New', counts.new], ['update', 'Will be updated', (counts.update || 0) + (counts.restore || 0)],
    ['keptDeleted', 'Kept deleted', counts.keptDeleted], ['unchanged', 'No changes', counts.unchanged]
].filter(([k, , c]) => (c as number) > 0 || k === 'decision' || k === 'new') as [string, string, number][]);

/** The tab step 3 opens on: a decision first, then the deleted, else New. */
export const firstReviewTab = (counts: Loose) => (counts.decision ? 'decision' : counts.deleted ? 'deleted' : 'new');

/** Where continuing a saved draft lands: names still to answer → 2, else the review. */
export const draftStep = (plan: Loose) => (plan.blockers?.length && (plan.unresolvedReps.length || plan.unresolvedBranches.length) ? 2 : 3);

/** What stops Start import for this login: connecting needs Edit, bringing back needs Add. */
export const blockedFor = (plan: Loose | null, canEdit: boolean, canAdd: boolean) =>
    (plan?.needs?.edit && !canEdit ? 'Some customers here connect to existing ones, which needs the Edit customer switch.' : '')
    || (plan?.needs?.add && !canAdd ? 'Bringing back a deleted customer needs the Add customer switch.' : '');

/** The plan as a CSV: every SPS row with what will happen to it (with a BOM, for Excel). */
export const planCsvText = (rows: Loose) => {
    const lines = [['Row', 'SPS customer', 'Plan'].map(csvCell).join(',')];
    for (const [k, label] of [['new', 'New'], ['update', 'Update'], ['decision', 'Need a decision'], ['deleted', 'Deleted before'], ['keptDeleted', 'Kept deleted'], ['unchanged', 'No changes']]) {
        for (const r of rows[k] || []) lines.push([r.rowNumber, r.name, label].map(csvCell).join(','));
    }
    return `\uFEFF${lines.join('\r\n')}`;
};
