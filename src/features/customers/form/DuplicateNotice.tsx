/** "This may be a customer you already have": the possible duplicates of a new customer, each with Open it, and It’s a different business. */
import { Info } from 'lucide-react';
import type { Loose } from '../../../types/records';
import { dupName, dupMeta } from './customerFormView';
import type { DuplicateMatch } from './useDuplicateCheck';

export default function DuplicateNotice({ matches, onOpen, onDismiss }: {
    matches: DuplicateMatch[];
    /** Absent when the caller can't open a customer (the notice then has no Open it). */
    onOpen: ((customer: Loose) => void) | null;
    onDismiss: () => void;
}) {
    return (
        <div className="cf-dup" role="status">
            <Info size={16} aria-hidden="true" />
            <div className="cf-dup-body">
                <strong>This may be a customer you already have</strong>
                {matches.map(({ customer: m, signals }) => (
                    <div className="cf-dup-row" key={m._id}>
                        <div className="cf-dup-text">
                            <b>{dupName(m)}</b>
                            <span>{dupMeta(m)}</span>
                            <span>Matches on: {signals.join(', ')}</span>
                        </div>
                        {onOpen && (
                            <button type="button" className="fm-btn fm-btn-small" onClick={() => onOpen(m)}>Open it</button>
                        )}
                    </div>
                ))}
                <button type="button" className="cf-link" onClick={onDismiss}>It’s a different business</button>
            </div>
        </div>
    );
}
