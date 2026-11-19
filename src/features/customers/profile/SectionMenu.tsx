import { useEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { lockPage, unlockPage } from '../../../components/shared/pageLock';

export type SectionItem = { key: string; label: string; icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean }>; n: number };

/**
 * Phone only (under 640px, CustomerProfile.css): the profile's sections as one bar that names
 * where you are ("Visits 5 ▾"). Tapping it drops a card listing every section with its count,
 * the way a WhatsApp chat's menu opens (design: claude.ai artifact "Profile Section Menu",
 * https://claude.ai/artifact/CgPSBxMgobnNkVuvXU2Vui). It takes whatever sections it is given, so
 * a new tab is a new row, not a new layout. The page behind is locked while it is open; a tap
 * there, the ✕ or Esc only closes it, and picking a row switches the section and closes it.
 */
export default function SectionMenu({ items, active, name, onPick }: { items: SectionItem[]; active: string; name: string; onPick: (key: string) => void }) {
    const [open, setOpen] = useState(false);
    const [top, setTop] = useState(120);
    const barRef = useRef<HTMLButtonElement>(null);
    const currentRef = useRef<HTMLButtonElement>(null);
    const current = items.find(i => i.key === active) || items[0];
    const Icon = current.icon;

    useEffect(() => {
        if (!open) return;
        lockPage();
        currentRef.current?.focus({ preventScroll: true });
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { setOpen(false); barRef.current?.focus({ preventScroll: true }); }
        };
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('keydown', onKey); unlockPage(); };
    }, [open]);

    const show = () => {
        // The card opens just under the bar, never off the top of the screen.
        const r = barRef.current?.getBoundingClientRect();
        setTop(Math.max(72, Math.round((r?.bottom ?? 120) + 8)));
        setOpen(true);
    };
    const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '•';

    return (
        <div className="cp-secbar">
            <button ref={barRef} type="button" className="cp-sec" aria-haspopup="menu" aria-expanded={open} onClick={() => (open ? setOpen(false) : show())}>
                <span className="cp-sec-ic"><Icon size={22} aria-hidden /></span>
                <span className="cp-sec-lab">{current.label}</span>
                {current.n > 0 && <span className="n">{current.n}</span>}
                <ChevronDown size={18} aria-hidden className="cp-sec-chev" />
            </button>
            {open && (
                <>
                    <div className="cp-sec-scrim" onClick={() => setOpen(false)} onTouchMove={e => e.preventDefault()} />
                    <div className="cp-sec-card" role="menu" aria-label="Customer sections" style={{ top, maxHeight: `calc(100dvh - ${top}px - 16px)` }}>
                        <div className="cp-sec-head">
                            <span className="cp-sec-av" aria-hidden="true">{initials}</span>
                            <b>{name}</b>
                            <button type="button" className="cp-sec-x" aria-label="Close menu" onClick={() => setOpen(false)}><X size={18} aria-hidden /></button>
                        </div>
                        {items.map(t => {
                            const I = t.icon;
                            const on = t.key === current.key;
                            return (
                                <button key={t.key} ref={on ? currentRef : undefined} type="button" role="menuitem" className="cp-sec-item"
                                    aria-current={on ? 'true' : undefined} onClick={() => { setOpen(false); onPick(t.key); }}>
                                    <span className="cp-sec-ic"><I size={22} aria-hidden /></span>
                                    <span className="cp-sec-t">{t.label}</span>
                                    {t.n > 0 && <span className="cp-sec-n">{t.n}</span>}
                                    <ChevronRight size={18} aria-hidden className="cp-sec-go" />
                                </button>
                            );
                        })}
                    </div>
                </>
            )}
        </div>
    );
}
