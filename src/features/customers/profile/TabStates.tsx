import type { ReactNode } from 'react';
import { Plus } from 'lucide-react';
import './CustomerProfile.css';

/** An empty tab: a "nothing yet" card that holds the tab's Add button (canvas, "Empty state"). */
export function TabEmpty({ icon, title, text, actionLabel, onAction }: { icon: ReactNode; title: string; text: string; actionLabel?: string; onAction?: () => void }) {
    return (
        <div className="cl cp">
            <div className="cl-sec cp-empty">
                <div className="cp-empty-ic" aria-hidden="true">{icon}</div>
                <h3>{title}</h3>
                <p>{text}</p>
                {actionLabel && onAction && (
                    <button type="button" className="cl-btn gold" onClick={onAction}><Plus size={18} aria-hidden="true" />{actionLabel}</button>
                )}
            </div>
        </div>
    );
}

/** A tab whose history is still on its way: three grey rows instead of a spinner. */
export function TabSkeleton() {
    return (
        <div className="cl cp">
            <div className="cl-sec cp-sk" role="status" aria-label="Loading">
                {[0, 1, 2].map(i => (
                    <div key={i} className="cp-sk-row"><span className="cp-sk-bar a" /><span className="cp-sk-bar b" /></div>
                ))}
            </div>
        </div>
    );
}
