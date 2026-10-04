import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    LayoutDashboard, User, Clock, Truck, Map as MapIcon, ClipboardList, Tag, TrendingDown, ArrowLeftRight, Boxes,
    Users, Briefcase, Warehouse, Layers, Shield, Home, Pin, PinOff, PanelLeftClose, PanelLeftOpen, X,
    Sun, Moon, LogOut, UserCheck
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { railSections, visiblePinnedTabs, sectionOf, navItem, MAX_PINNED_TABS } from '../../utils/navPins';
import './CustomerSidebar.css';

// Pages, sections and who sees what live in src/utils/navPins.js; only the
// icons are here. A page added there needs an icon added here.
const ITEM_ICONS = {
    dashboard: LayoutDashboard,
    customers: User,
    checkin: Clock,
    route_planner: MapIcon,
    lost_sales: TrendingDown,
    delivery_schedule: Truck,
    daily_report: ClipboardList,
    pricelist: Tag,
    inventory_analysis: Boxes,
    crossover_sheet: ArrowLeftRight,
    users: Users
};
const SECTION_ICONS = {
    home: LayoutDashboard,
    sales: Briefcase,
    operations: Warehouse,
    products: Layers,
    admin: Shield
};

// Desktop only: the sub-panel can be hidden, leaving just the section rail.
const PANEL_HIDDEN_KEY = 'sideNavPanelHidden';
const readPanelHidden = () => {
    try {
        return localStorage.getItem(PANEL_HIDDEN_KEY) === '1';
    } catch {
        return false;
    }
};

const getInitials = (name) => {
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
};

/**
 * The Sales CRM side nav (design "Option C"): a rail of sections, and a panel
 * with the person's pinned pages on top and the chosen section's pages below.
 * The first pin is their default page — where /sales opens (SalesPage's
 * getDefaultTab). On phones/tablets (isMobile) the whole thing is a drawer.
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
    onMakeDefault
}) => {
    const navigate = useNavigate();
    const { user, logout } = useAuth();

    const sections = railSections(user);
    const pins = visiblePinnedTabs(user, pinnedTabs);
    const pinsFull = (pinnedTabs || []).length >= MAX_PINNED_TABS;
    const currentSection = sectionOf(crmTab);

    const [panelHidden, setPanelHidden] = useState(readPanelHidden);
    const [viewSection, setViewSection] = useState(currentSection);
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef(null);

    // The panel follows the page you're on; clicking a section only previews it.
    const [lastSection, setLastSection] = useState(currentSection);
    if (currentSection !== lastSection) {
        setLastSection(currentSection);
        if (currentSection) setViewSection(currentSection);
    }

    useEffect(() => {
        try {
            localStorage.setItem(PANEL_HIDDEN_KEY, panelHidden ? '1' : '0');
        } catch {
            // storage unavailable — the panel just won't remember being hidden
        }
    }, [panelHidden]);

    useEffect(() => {
        if (!menuOpen) return undefined;
        const onDown = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
        };
        const onKey = (e) => {
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
    const onePageSection = !!shownSection && shownSection.id !== 'home' && shownSection.items.length === 1;
    const showPanel = isMobile || (!panelHidden && !onePageSection);

    const go = (tab) => {
        setMenuOpen(false);
        handleCrmTabChange(tab); // also closes the drawer on mobile
    };

    const openSection = (section) => {
        setViewSection(section.id);
        // A one-page section (Admin today) goes straight to it. Not Home:
        // that's where the pins are, so it always opens the panel.
        if (section.id !== 'home' && section.items.length === 1) {
            go(section.items[0].id);
            return;
        }
        if (!isMobile && panelHidden) setPanelHidden(false);
    };

    const handleLogout = async () => {
        setMenuOpen(false);
        await logout();
        navigate('/login');
    };

    const renderRow = (item, { inPinned = false, index = 0 } = {}) => {
        const Icon = ITEM_ICONS[item.id] || LayoutDashboard;
        const active = crmTab === item.id;
        const pinned = (pinnedTabs || []).includes(item.id);
        const isDefault = inPinned && index === 0;
        return (
            <div key={`${inPinned ? 'pin' : 'sec'}-${item.id}`} className={`side-nav-row${active ? ' active' : ''}`}>
                <button
                    type="button"
                    className="side-nav-link"
                    onClick={() => go(item.id)}
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
                {inPinned ? (
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
    };

    return (
        <nav
            aria-label="Main"
            className={`sales-sidebar side-nav${!isSidebarOpen ? ' closed' : ''}${showPanel ? '' : ' panel-hidden'}`}
        >
            {/* Section rail */}
            <div className="side-nav-rail">
                <div className="side-nav-logo" aria-hidden="true">ES</div>
                <div className="side-nav-sections">
                    {sections.map(section => {
                        const Icon = SECTION_ICONS[section.id] || LayoutDashboard;
                        const isCurrent = section.id === currentSection;
                        const isViewing = showPanel && section.id === shownSection?.id;
                        return (
                            <button
                                key={section.id}
                                type="button"
                                className={`side-nav-section${isCurrent ? ' is-current' : ''}${isViewing ? ' is-viewing' : ''}`}
                                onClick={() => openSection(section)}
                                title={section.id !== 'home' && section.items.length === 1 ? section.items[0].label : section.label}
                            >
                                <span className="side-nav-section-icon"><Icon size={20} /></span>
                                <span className="side-nav-section-label">{section.label}</span>
                            </button>
                        );
                    })}
                </div>

                {!showPanel && panelHidden && (
                    <button
                        type="button"
                        className="side-nav-icon-btn"
                        onClick={() => setPanelHidden(false)}
                        aria-label="Show menu panel"
                        title="Show menu panel"
                    >
                        <PanelLeftOpen size={20} />
                    </button>
                )}

                {user && (
                    <div className="side-nav-account" ref={menuRef}>
                        <button
                            type="button"
                            className={`side-nav-avatar${crmTab === 'profile' ? ' is-current' : ''}`}
                            onClick={() => setMenuOpen(o => !o)}
                            aria-haspopup="menu"
                            aria-expanded={menuOpen}
                            aria-label="Account menu"
                            title={`${user.contactName || user.name || 'Account'}${user.role ? ` · ${user.role}` : ''}`}
                        >
                            {getInitials(user.contactName || user.name)}
                        </button>
                        {menuOpen && (
                            <div className="side-nav-menu" role="menu">
                                <div className="side-nav-menu-head">
                                    <span className="side-nav-menu-name">{user.contactName || user.name}</span>
                                    <span className="side-nav-menu-role">{user.role || 'Sales Rep'}</span>
                                </div>
                                <button type="button" role="menuitem" className="side-nav-menu-item" onClick={() => go('profile')}>
                                    <UserCheck size={16} /><span>My Profile</span>
                                </button>
                                <button
                                    type="button"
                                    role="menuitem"
                                    className="side-nav-menu-item"
                                    onClick={() => { toggleTheme(); setMenuOpen(false); }}
                                >
                                    {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                                    <span>{theme === 'dark' ? 'Light theme' : 'Dark theme'}</span>
                                </button>
                                <div className="side-nav-menu-divider" />
                                <button type="button" role="menuitem" className="side-nav-menu-item danger" onClick={handleLogout}>
                                    <LogOut size={16} /><span>Sign out</span>
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Pinned + section panel */}
            {showPanel && (() => {
                // Hide-panel (desktop) / close-drawer (mobile) button, at the
                // right end of the panel's first heading rather than a row of its own.
                const panelButton = isMobile ? (
                    <button
                        type="button"
                        className="side-nav-icon-btn side-nav-head-btn"
                        onClick={() => setIsSidebarOpen(false)}
                        aria-label="Close menu"
                        title="Close menu"
                    >
                        <X size={18} />
                    </button>
                ) : (
                    <button
                        type="button"
                        className="side-nav-icon-btn side-nav-head-btn"
                        onClick={() => { setPanelHidden(true); setMenuOpen(false); }}
                        aria-label="Hide menu panel"
                        title="Hide menu panel"
                    >
                        <PanelLeftClose size={18} />
                    </button>
                );
                const isHome = shownSection?.id === 'home';
                const sectionItems = !shownSection ? [] : isHome
                    ? shownSection.items.filter(item => !pins.includes(item.id))
                    : shownSection.items;
                return (
                <div className="side-nav-panel">
                    <div className="side-nav-panel-body">
                        {/* Home lists the pins (plus the Dashboard, unless it's
                            pinned already); every other section only its own pages. */}
                        {isHome && (
                            <div className="side-nav-group">
                                <div className="side-nav-group-head">
                                    <span className="side-nav-group-label">Pinned</span>
                                    {panelButton}
                                </div>
                                {pins.length > 0 ? (
                                    pins.map((id, index) => renderRow(navItem(id), { inPinned: true, index }))
                                ) : (
                                    <p className="side-nav-empty">
                                        Pin the pages you use most from any section. Your first pin is the page that opens when you sign in.
                                    </p>
                                )}
                            </div>
                        )}

                        {sectionItems.length > 0 && (
                            <div className="side-nav-group">
                                <div className="side-nav-group-head">
                                    <span className="side-nav-group-label">{shownSection.label}</span>
                                    {!isHome && panelButton}
                                </div>
                                {sectionItems.map(item => renderRow(item))}
                            </div>
                        )}
                    </div>
                </div>
                );
            })()}
        </nav>
    );
};

export default CustomerSidebar;
