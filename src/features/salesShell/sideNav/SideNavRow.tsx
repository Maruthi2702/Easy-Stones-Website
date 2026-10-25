/** One page in the side nav's panel: its link, and pin / unpin / make-default buttons (a link out has no pin). */
import type React from 'react';
import { LayoutDashboard, Home, Pin, PinOff } from 'lucide-react';
import { MAX_PINNED_TABS } from '../../../utils/navPins';
import { ITEM_ICONS } from '../../../components/sales/navIcons';

/** A side nav section (navPins.js railSections) and one of its pages. */
export type NavPage = { id: string; label: string; href?: string };
export type NavSection = { id: string; label: string; items: NavPage[] };
export type IconMap = Record<string, React.ComponentType<{ size?: number }>>;

/** What every row needs from the side nav. */
export type RowContext = {
    crmTab: string;
    pinnedTabs: string[] | null | undefined;
    pinsFull: boolean;
    onGo: (tab: string) => void;
    onTogglePin: (id: string) => void;
    onMakeDefault: (id: string) => void;
};

export default function SideNavRow({ item, inPinned = false, index = 0, ctx }: { item: NavPage; inPinned?: boolean; index?: number; ctx: RowContext }) {
    const { crmTab, pinnedTabs, pinsFull, onGo, onTogglePin, onMakeDefault } = ctx;
    const Icon = (ITEM_ICONS as IconMap)[item.id] || LayoutDashboard;
    const active = crmTab === item.id;
    const pinned = (pinnedTabs || []).includes(item.id);
    const isDefault = inPinned && index === 0;
    return (
        <div className={`side-nav-row${active ? ' active' : ''}`}>
            <button
                type="button"
                className="side-nav-link"
                onClick={() => onGo(item.id)}
                aria-current={active ? 'page' : undefined}
            >
                <Icon size={18} />
                <span className="side-nav-link-label">{item.label}</span>
                {isDefault && (
                    <span className="side-nav-default-tag" title="Opens first when you sign in">Default</span>
                )}
            </button>
            {inPinned && !isDefault && (
                <button
                    type="button"
                    className="side-nav-row-action"
                    onClick={() => onMakeDefault(item.id)}
                    aria-label={`Make ${item.label} your default page`}
                    title="Make default (opens first when you sign in)"
                >
                    <Home size={15} />
                </button>
            )}
            {item.href ? null : inPinned ? (
                <button
                    type="button"
                    className="side-nav-row-action"
                    onClick={() => onTogglePin(item.id)}
                    aria-label={`Unpin ${item.label}`}
                    title="Unpin"
                >
                    <PinOff size={15} />
                </button>
            ) : (
                <button
                    type="button"
                    className={`side-nav-row-action${pinned ? ' is-pinned' : ''}`}
                    onClick={() => onTogglePin(item.id)}
                    disabled={!pinned && pinsFull}
                    aria-pressed={pinned}
                    aria-label={pinned ? `Unpin ${item.label}` : `Pin ${item.label}`}
                    title={pinned ? 'Unpin' : (pinsFull ? `You can pin up to ${MAX_PINNED_TABS} pages` : 'Pin to the top')}
                >
                    <Pin size={15} fill={pinned ? 'currentColor' : 'none'} />
                </button>
            )}
        </div>
    );
}
