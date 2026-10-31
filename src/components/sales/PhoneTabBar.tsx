import type { Loose } from '../../types/records.ts';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutDashboard, Menu, Search, X, Sun, Moon, LogOut, ShoppingCart } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { navItem } from '../../utils/navPins';
import {
    phoneNavModel, opensDirectly, litTab, moreGroups, searchPages, highlightParts, MORE
} from '../../utils/phoneNav';
import { useCart, cartActions } from '../../features/holds';
import { CART, can } from '../../holds/permissions';
import { ITEM_ICONS, SECTION_ICONS } from './navIcons';
import '../shared/form/FormModal.css';
import './PhoneTabBar.css';

/*
 * The phone's bottom tab bar (owner's design, 2026-10-18 — claude.ai artifacts
 * "Phone tab bar canvas" and "Phone menu search"): Dashboard · two modules ·
 * More. Phones only (under 640px, SalesPage); tablets and desktop keep the
 * rail and the drawer. What sits on the bar, what is lit and what the search
 * finds is in src/utils/phoneNav.js (tested) — this file only draws it.
 *
 * A module tab opens a sheet of that module's pages; More opens a sheet with
 * the account (profile, cart, theme, sign out), a page search, the pinned
 * pages and every module that didn't fit on the bar. Picking a page closes the
 * sheet; so do the dimmed page behind it, Esc and the tab again. While a text
 * box has the keyboard the bar steps aside (and the page gets its room back).
 * Colours are the form template's tokens (.fm-tokens), so dark/light follow
 * the app.
 */

const TEXT_INPUT = 'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="file"]):not([type="range"]):not([type="color"]), textarea, select, [contenteditable="true"]';

const getInitials = (name: string) => {
    if (!name) return 'U';
    return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
};

function Tile({ item, active, query, pinned, onPick }: { item: Loose; active: boolean; query: string; pinned: boolean; onPick: (id: string) => void }) {
    const Icon = ITEM_ICONS[item.id] || LayoutDashboard;
    const { pre, hit, post } = highlightParts(item.label, query);
    return (
        <button type="button" className={`pt-tile${active ? ' on' : ''}`} onClick={() => onPick(item.id)} aria-current={active ? 'page' : undefined}>
            <span className="pt-tile-icon"><Icon size={20} aria-hidden="true" /></span>
            <span className="pt-tile-name">{pre}{hit && <span className="pt-hit">{hit}</span>}{post}</span>
            {pinned && <span className="pt-pin" role="img" aria-label="Pinned" />}
        </button>
    );
}

export default function PhoneTabBar({ crmTab, onNavigate, theme, toggleTheme, navOrder, pinnedTabs }: { crmTab: string; onNavigate: (tab: string) => void; theme: string; toggleTheme: () => void; navOrder: Loose | null; pinnedTabs: string[] }) {
    const navigate = useNavigate();
    const { user, logout } = useAuth();
    const model = useMemo(() => phoneNavModel(user, navOrder, pinnedTabs), [user, navOrder, pinnedTabs]);
    const [sheet, setSheet] = useState<string | null>(null); // a module's id, or MORE
    const [query, setQuery] = useState('');
    const [keyboard, setKeyboard] = useState(false);
    const sheetRef = useRef<HTMLDivElement | null>(null);
    const { cart, loaded } = useCart();
    const cartAllowed = can(user, CART.USE);

    useEffect(() => {
        if (cartAllowed && !loaded) cartActions.load();
    }, [cartAllowed, loaded]);

    // The bar steps aside while a text box has the keyboard — unless the box is
    // the sheet's own search, which sits above the bar anyway.
    useEffect(() => {
        const onIn = (e: FocusEvent) => {
            if ((e.target as HTMLElement | null)?.matches?.(TEXT_INPUT) && !sheetRef.current?.contains(e.target as Node)) setKeyboard(true);
        };
        const onOut = () => setKeyboard(false);
        document.addEventListener('focusin', onIn);
        document.addEventListener('focusout', onOut);
        return () => {
            document.removeEventListener('focusin', onIn);
            document.removeEventListener('focusout', onOut);
        };
    }, []);

    const shown = !keyboard || sheet !== null;
    // has-phone-bar: the bar replaces the drawer, so the drawer's menu buttons
    // go (for as long as the bar is mounted). phone-bar-up: the page makes room
    // for the bar only while it's on screen, not while the keyboard is up.
    useEffect(() => {
        document.body.classList.add('has-phone-bar');
        return () => document.body.classList.remove('has-phone-bar');
    }, []);
    useEffect(() => {
        document.body.classList.toggle('phone-bar-up', shown);
        return () => document.body.classList.remove('phone-bar-up');
    }, [shown]);

    // Focus the sheet so Esc and the keyboard work from the first key.
    useEffect(() => {
        if (sheet) sheetRef.current?.focus({ preventScroll: true });
    }, [sheet]);

    const closeSheet = () => { setSheet(null); setQuery(''); };
    const go = (tab: string) => { closeSheet(); onNavigate(tab); };
    const toggleSheet = (id: string) => { setQuery(''); setSheet((open) => (open === id ? null : id)); };
    const handleLogout = async () => {
        closeSheet();
        await logout();
        navigate('/login');
    };

    const lit = sheet || litTab(crmTab, model);
    const tabs = [
        ...(model.dashboard ? [{ id: 'dashboard', label: 'Dashboard', Icon: SECTION_ICONS.home, page: 'dashboard' }] : []),
        ...model.bar.map((s) => ({
            id: s.id, label: s.label, Icon: SECTION_ICONS[s.id] || LayoutDashboard,
            page: opensDirectly(s) ? s.items[0].id : null
        })),
        { id: MORE, label: 'More', Icon: Menu, page: null }
    ];

    // What the open sheet lists.
    const searching = sheet === MORE && query.trim() !== '';
    let groups = [];
    if (sheet === MORE) groups = searching ? searchPages(user, navOrder, query) : moreGroups(model, navItem);
    else if (sheet) {
        const section = model.bar.find((s) => s.id === sheet);
        if (section) groups = [{ id: section.id, label: section.label, items: section.items }];
    }
    const sheetLabel = sheet === MORE ? 'More' : model.bar.find((s) => s.id === sheet)?.label || '';
    const name = user?.contactName || user?.name || '';
    const cartCount = cart.lines.length;

    return (
        <div className={`pt-root fm-tokens${shown ? '' : ' pt-hidden'}`} data-theme={theme}>
            {sheet && (
                <>
                    <button type="button" className="pt-scrim" aria-label="Close menu" onClick={closeSheet} />
                    <div
                        ref={sheetRef}
                        className="pt-sheet"
                        role="dialog"
                        aria-label={sheetLabel}
                        tabIndex={-1}
                        onKeyDown={(e) => {
                            if (e.key === 'Escape') { e.stopPropagation(); closeSheet(); }
                        }}
                    >
                        <div className="pt-grip" aria-hidden="true" />
                        {sheet === MORE && (
                            <>
                                {user && (
                                    <div className="pt-account">
                                        <button type="button" className="pt-who" onClick={() => go('profile')} aria-label="My profile">
                                            <span className="pt-avatar" aria-hidden="true">{getInitials(name)}</span>
                                            <span className="pt-who-text">
                                                <span className="pt-who-name">{name}</span>
                                                <span className="pt-who-role">{(user.role || 'Sales Rep').replace(/_/g, ' ')}</span>
                                            </span>
                                        </button>
                                        {cartAllowed && (
                                            <button
                                                type="button"
                                                className="pt-ibtn"
                                                aria-label={`Cart, ${cartCount} slab${cartCount === 1 ? '' : 's'}`}
                                                onClick={() => { closeSheet(); cartActions.open(); }}
                                            >
                                                <ShoppingCart size={18} aria-hidden="true" />
                                                {cartCount > 0 && <span className="pt-badge" aria-hidden="true">{cartCount > 99 ? '99+' : cartCount}</span>}
                                            </button>
                                        )}
                                        <button type="button" className="pt-ibtn" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
                                            {theme === 'dark' ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
                                        </button>
                                        <button type="button" className="pt-ibtn" onClick={handleLogout} aria-label="Sign out">
                                            <LogOut size={18} aria-hidden="true" />
                                        </button>
                                    </div>
                                )}
                                <label className="pt-search">
                                    <Search size={17} aria-hidden="true" />
                                    <input
                                        type="search"
                                        value={query}
                                        onChange={(e) => setQuery(e.target.value)}
                                        placeholder="Search pages"
                                        aria-label="Search pages"
                                        autoComplete="off"
                                        autoCorrect="off"
                                        spellCheck={false}
                                    />
                                    {query && (
                                        <button type="button" className="pt-search-x" aria-label="Clear search" onClick={() => setQuery('')}>
                                            <X size={16} aria-hidden="true" />
                                        </button>
                                    )}
                                </label>
                            </>
                        )}
                        {groups.map((group) => (
                            <section key={group.id}>
                                <h2 className="pt-group">{group.label}</h2>
                                <div className="pt-grid">
                                    {group.items.map((item) => (
                                        <Tile
                                            key={item.id}
                                            item={item}
                                            query={searching ? query : ''}
                                            active={crmTab === item.id}
                                            pinned={model.pins.includes(item.id)}
                                            onPick={go}
                                        />
                                    ))}
                                </div>
                            </section>
                        ))}
                        {searching && groups.length === 0 && (
                            <div className="pt-empty" role="status">
                                <strong>No pages match “{query.trim()}”</strong>
                                <span>This finds pages, not customers or orders.</span>
                            </div>
                        )}
                    </div>
                </>
            )}

            <nav className="pt-bar" aria-label="Main">
                {tabs.map((tab) => {
                    const on = lit === tab.id;
                    const sheetTab = tab.page === null && tab.id !== 'dashboard';
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            className={`pt-tab${on ? ' on' : ''}`}
                            aria-current={on && !sheet && !sheetTab ? 'page' : undefined}
                            aria-expanded={sheetTab ? sheet === tab.id : undefined}
                            onClick={() => (sheetTab ? toggleSheet(tab.id) : go(tab.page))}
                        >
                            <span className="pt-pill"><tab.Icon size={20} aria-hidden="true" /></span>
                            <span className="pt-label">{tab.label}</span>
                        </button>
                    );
                })}
            </nav>
        </div>
    );
}
