/** The account button at the foot of the rail and its menu: My Profile, the theme, Sign out. */
import type React from 'react';
import { Sun, Moon, LogOut, UserCheck } from 'lucide-react';
import type { Loose } from '../../../types/records';
import { getInitials } from './sideNav';

export type AccountMenuProps = {
    user: Loose;
    crmTab: string;
    menuOpen: boolean;
    setMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
    menuRef: React.RefObject<HTMLDivElement | null>;
    theme: string;
    toggleTheme: () => void;
    onGo: (tab: string) => void;
    onLogout: () => void;
};

export default function AccountMenu({ user, crmTab, menuOpen, setMenuOpen, menuRef, theme, toggleTheme, onGo, onLogout }: AccountMenuProps) {
    return (
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
                    <button type="button" role="menuitem" className="side-nav-menu-item" onClick={() => onGo('profile')}>
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
                    <button type="button" role="menuitem" className="side-nav-menu-item danger" onClick={onLogout}>
                        <LogOut size={16} /><span>Sign out</span>
                    </button>
                </div>
            )}
        </div>
    );
}
