/**
 * The side nav's panel: the section's name with the hide-panel (desktop) or
 * close-drawer (mobile) button, then Home's pins (or the section's pages), and
 * the pin tip for new staff.
 */
import { Pin, PanelLeftClose, X } from 'lucide-react';
import { navItem, MAX_PINNED_TABS } from '../../../utils/navPins';
import SideNavRow from './SideNavRow';
import type { NavPage, NavSection, RowContext } from './SideNavRow';

export type SideNavPanelProps = {
    isMobile: boolean;
    shownSection: NavSection | undefined;
    pins: string[];
    showPinHints: boolean;
    ctx: RowContext;
    /** Mobile: closes the drawer. */
    onCloseDrawer: () => void;
    /** Desktop: closes the fly-out (and the account menu). */
    onClosePanel: () => void;
    onDismissPinTip: () => void;
};

export default function SideNavPanel({ isMobile, shownSection, pins, showPinHints, ctx, onCloseDrawer, onClosePanel, onDismissPinTip }: SideNavPanelProps) {
    // Hide-panel (desktop) / close-drawer (mobile) button, at the
    // right end of the panel's first heading rather than a row of its own.
    const panelButton = isMobile ? (
        <button
            type="button"
            className="side-nav-icon-btn side-nav-head-btn"
            onClick={onCloseDrawer}
            aria-label="Close menu"
            title="Close menu"
        >
            <X size={18} />
        </button>
    ) : (
        <button
            type="button"
            className="side-nav-icon-btn side-nav-head-btn"
            onClick={onClosePanel}
            aria-label="Close menu panel"
            title="Close menu panel"
        >
            <PanelLeftClose size={18} />
        </button>
    );
    const isHome = shownSection?.id === 'home';
    const sectionItems = !shownSection ? [] : isHome
        ? shownSection.items.filter(item => !pins.includes(item.id))
        : shownSection.items;
    return (
        <div className={`side-nav-panel${showPinHints ? ' show-pin-hints' : ''}`}>
            {/* The section's name as the panel's title, with the
                hide-panel / close button beside it. */}
            <div className="side-nav-panel-title-row">
                <h2 className="side-nav-panel-title">{shownSection?.label}</h2>
                <span className="side-nav-title-actions">
                    {panelButton}
                </span>
            </div>
            <div className="side-nav-panel-body">
                {/* Home lists the pins (plus the Dashboard, unless it's
                    pinned already); every other section only its own pages. */}
                {isHome && (
                    <div className="side-nav-group">
                        <div className="side-nav-group-label">
                            Pinned
                            {pins.length > 0 && (
                                <span className="side-nav-group-count" title={`You can pin up to ${MAX_PINNED_TABS} pages`}>
                                    {pins.length}/{MAX_PINNED_TABS}
                                </span>
                            )}
                        </div>
                        {pins.length > 0 ? (
                            pins.map((id, index) => <SideNavRow key={`pin-${id}`} item={navItem(id) as NavPage} inPinned index={index} ctx={ctx} />)
                        ) : (
                            <p className="side-nav-empty">
                                Pin the pages you use most from any section. Your first pin is the page that opens when you sign in.
                            </p>
                        )}
                    </div>
                )}

                {sectionItems.length > 0 && (
                    <div className="side-nav-group">
                        {isHome && <div className="side-nav-group-label">Pages</div>}
                        {sectionItems.map(item => <SideNavRow key={`sec-${item.id}`} item={item} ctx={ctx} />)}
                    </div>
                )}

                {/* Home already explains pins in its empty Pinned list. */}
                {showPinHints && !isHome && (
                    <div className="side-nav-tip" role="note">
                        <div className="side-nav-tip-text">
                            <Pin size={16} aria-hidden="true" />
                            <p>Tap the pin next to a page to keep it on Home. Your first pin is the page that opens when you sign in.</p>
                        </div>
                        <button type="button" className="side-nav-tip-btn" onClick={onDismissPinTip}>Got it</button>
                    </div>
                )}
            </div>
        </div>
    );
}
