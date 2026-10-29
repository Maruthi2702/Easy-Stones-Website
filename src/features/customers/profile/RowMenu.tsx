import { useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useDismiss, anchoredMenuStyle } from '../list/uiHelpers';
import './CustomerProfile.css';

export type RowMenuProps = {
    /** What the row is, in the menu's words: "resource", "contact". */
    noun: string;
    onEdit?: () => void;
    onDelete?: () => void;
};

/**
 * The ⋯ on a row of a profile tab: Edit and Delete in the same menu as the
 * profile header's. Renders nothing when the login has neither.
 */
export default function RowMenu({ noun, onEdit, onDelete }: RowMenuProps) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState<CSSProperties | undefined>();
    // Only a menu placed on the screen drifts from its button when the page scrolls; the phone's sheet doesn't.
    useDismiss(open, setOpen, ref, { closeOnScroll: Boolean(pos) });
    if (!onEdit && !onDelete) return null;
    const run = (fn?: () => void) => () => { setOpen(false); fn?.(); };
    return (
        <div className="cl cp cp-rm" ref={ref} onClick={(e) => e.stopPropagation()}>
            <button type="button" className="cl-ib" aria-label={`${noun[0].toUpperCase()}${noun.slice(1)} actions`} aria-haspopup="menu" aria-expanded={open} onClick={(e) => {
                // A table or card list scrolls sideways and would clip an absolute menu, so it
                // sits on the screen beside its button (the list's ⋯ does the same); a phone
                // gets the bottom sheet from the CSS instead.
                setPos(window.innerWidth > 640 ? anchoredMenuStyle(e.currentTarget, { align: 'right', estHeight: 120 }) : undefined);
                setOpen(o => !o);
            }}>
                <MoreHorizontal size={18} aria-hidden="true" />
            </button>
            {open && (
                <>
                    <div className="cp-scrim" onClick={() => setOpen(false)} aria-hidden="true" />
                    <div className="cp cp-menu cp-rowm" role="menu" aria-label={`${noun} actions`} style={pos}>
                        <div className="cp-sheet-h" aria-hidden="true" />
                        {onEdit && <button type="button" className="cp-mi" role="menuitem" onClick={run(onEdit)}><Pencil size={18} aria-hidden="true" />Edit {noun}</button>}
                        {onEdit && onDelete && <div className="cp-sep" role="separator" />}
                        {onDelete && <button type="button" className="cp-mi danger" role="menuitem" onClick={run(onDelete)}><Trash2 size={18} aria-hidden="true" />Delete {noun}…</button>}
                    </div>
                </>
            )}
        </div>
    );
}
