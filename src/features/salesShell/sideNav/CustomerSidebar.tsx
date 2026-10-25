import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutDashboard } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { railSections, visiblePinnedTabs, sectionOf, MAX_PINNED_TABS, isOnePageSection } from '../../../utils/navPins';
import { CartRailButton } from '../../holds';
import { SECTION_ICONS } from '../../../components/sales/navIcons';
import type { Loose } from '../../../types/records';
import { readPinTipDismissed, savePinTipDismissed } from './sideNav';
import type { IconMap, NavSection, RowContext } from './SideNavRow';
import AccountMenu from './AccountMenu';
import SideNavPanel from './SideNavPanel';
import './CustomerSidebar.css';

export type CustomerSidebarProps = {
    crmTab: string;
    handleCrmTabChange: (tab: string) => void;
    isSidebarOpen: boolean;
    isMobile: boolean;
    setIsSidebarOpen: (open: boolean) => void;
    theme: string;
    toggleTheme: () => void;
    pinnedTabs: string[] | null | undefined;
    onTogglePin: (id: string) => void;
    onMakeDefault: (id: string) => void;
    navOrder: unknown;
};

/**
 * The Sales CRM side nav (design "Option C"): a rail of sections, and a panel
 * with the person's pinned pages on top and the chosen section's pages below.
 * The first pin is their default page — where /sales opens (SalesPage's
 * getDefaultTab). On phones/tablets (isMobile) the whole thing is a drawer.
 * The panel is SideNavPanel (its rows SideNavRow), the account button AccountMenu.
 */
const CustomerSidebar = ({
    crmTab,
    handleCrmTabChange,
    isSidebarOpen,
    isMobile,
    setIsSidebarOpen,
    theme,
    toggleTheme,
    pinnedTabs,
    onTogglePin,
    onMakeDefault,
    navOrder
}: CustomerSidebarProps) => {
    const navigate = useNavigate();
    const { user, logout } = useAuth() as { user: Loose | null; logout: () => Promise<void> };

    const [pinTipDismissed, setPinTipDismissed] = useState(readPinTipDismissed);
    const showPinHints = !pinTipDismissed && (pinnedTabs || []).length === 0;
    const dismissPinTip = () => {
        setPinTipDismissed(true);
        savePinTipDismissed();
    };
    const sections: NavSection[] = railSections(user, navOrder);
    const pins: string[] = visiblePinnedTabs(user, pinnedTabs);
    const pinsFull = (pinnedTabs || []).length >= MAX_PINNED_TABS;
    const currentSection = sectionOf(crmTab);

    // Desktop: the panel is a fly-out over the page, not a column beside it.
    // A section on the rail opens it; picking a page, clicking outside it or
    // Esc closes it, so every page keeps its full width (2026-10-09 — it
    // used to stay docked until "Hide panel", squeezing wide tables like the
    // Check-In Log). Phones and tablets keep their drawer (isMobile).
    const [flyoutOpen, setFlyoutOpen] = useState(false);
    const navRef = useRef<HTMLElement | null>(null);
    const [viewSection, setViewSection] = useState(currentSection);
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement | null>(null);

    // The panel follows the page you're on; clicking a section only previews it.
    const [lastSection, setLastSection] = useState(currentSection);
    if (currentSection !== lastSection) {
        setLastSection(currentSection);
        if (currentSection) setViewSection(currentSection);
    }

    useEffect(() => {
        if (isMobile || !flyoutOpen) return undefined;
        const onDown = (e: MouseEvent) => {
            if (navRef.current && !navRef.current.contains(e.target as Node)) setFlyoutOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setFlyoutOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [flyoutOpen, isMobile]);

    useEffect(() => {
        if (!menuOpen) return undefined;
        const onDown = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setMenuOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [menuOpen]);

    const shownSection = sections.find(s => s.id === viewSection)
        || sections.find(s => s.id === currentSection)
        || sections[0];
    // A one-page section (Admin today) has nothing to list beyond the page
    // you're already on, so on desktop it's just the rail. Home always keeps
    // its panel (the pins), and the mobile drawer always needs one.
    const onePageSection = isOnePageSection(shownSection);
    const showPanel = isMobile || (flyoutOpen && !onePageSection);

    const go = (tab: string) => {
        setMenuOpen(false);
        setFlyoutOpen(false);
        handleCrmTabChange(tab); // also closes the drawer on mobile
    };

    const openSection = (section: NavSection) => {
        setViewSection(section.id);
        // A one-page section (Admin today) goes straight to it. Not Home —
        // that's where the pins are — nor Accounting (isOnePageSection).
        if (isOnePageSection(section)) {
            go(section.items[0].id);
            return;
        }
        if (isMobile) return;
        // The open section's icon again closes it; another section switches.
        setFlyoutOpen(open => !(open && viewSection === section.id));
    };

    const handleLogout = async () => {
        setMenuOpen(false);
        await logout();
        navigate('/login');
    };

    const rowContext: RowContext = { crmTab, pinnedTabs, pinsFull, onGo: go, onTogglePin, onMakeDefault };

    return (
        <nav
            ref={navRef}
            aria-label="Main"
            className={`sales-sidebar side-nav${!isSidebarOpen ? ' closed' : ''}${showPanel ? '' : ' panel-hidden'}`}
        >
            {/* Section rail */}
            <div className="side-nav-rail">
                <div className="side-nav-logo" aria-hidden="true">ES</div>
                <div className="side-nav-sections">
                    {sections.map(section => {
                        const Icon = (SECTION_ICONS as IconMap)[section.id] || LayoutDashboard;
                        const isCurrent = section.id === currentSection;
                        const isViewing = showPanel && section.id === shownSection?.id;
                        return (
                            <button
                                key={section.id}
                                type="button"
                                className={`side-nav-section${isCurrent ? ' is-current' : ''}${isViewing ? ' is-viewing' : ''}`}
                                onClick={() => openSection(section)}
                                aria-expanded={!isMobile && !isOnePageSection(section) ? isViewing : undefined}
                                title={isOnePageSection(section) ? section.items[0].label : section.label}
                            >
                                <span className="side-nav-section-icon"><Icon size={20} /></span>
                                <span className="side-nav-section-label">{section.label}</span>
                            </button>
                        );
                    })}
                </div>

                {/* The cart, for everyone with the Use cart permission (src/holds/). */}
                <CartRailButton user={user} />

                {user && (
                    <AccountMenu
                        user={user}
                        crmTab={crmTab}
                        menuOpen={menuOpen}
                        setMenuOpen={setMenuOpen}
                        menuRef={menuRef}
                        theme={theme}
                        toggleTheme={toggleTheme}
                        onGo={go}
                        onLogout={handleLogout}
                    />
                )}
            </div>

            {/* Pinned + section panel */}
            {showPanel && (
                <SideNavPanel
                    isMobile={isMobile}
                    shownSection={shownSection}
                    pins={pins}
                    showPinHints={showPinHints}
                    ctx={rowContext}
                    onCloseDrawer={() => setIsSidebarOpen(false)}
                    onClosePanel={() => { setFlyoutOpen(false); setMenuOpen(false); }}
                    onDismissPinTip={dismissPinTip}
                />
            )}
        </nav>
    );
};

export default CustomerSidebar;
