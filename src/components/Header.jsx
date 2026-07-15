import { NavLink, Link, useNavigate } from 'react-router-dom';
import { Menu, LogOut, X, Package, Warehouse, TrendingUp, ShieldCheck, PhoneCall } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useState, useEffect } from 'react';
import './Header.css';

const Header = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('checkin_theme');
      return saved === 'light' ? 'light' : 'dark';
    } catch (e) {
      return 'dark';
    }
  });

  useEffect(() => {
    const handleStorageChange = () => {
      try {
        const saved = localStorage.getItem('checkin_theme');
        setTheme(saved === 'light' ? 'light' : 'dark');
      } catch (e) {}
    };
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('checkin_theme_changed', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('checkin_theme_changed', handleStorageChange);
    };
  }, []);

  /* navigate('/login') is needed. Adding useNavigate hook. */

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false);
  };



  return (
    <header className={`header glass-panel ${theme}-theme`}>
      <div className="container header-content">
        <Link to="/" className="logo">
          <img src="/logo.png" alt="Easy Stones" className="logo-image" />
        </Link>

        <nav className="nav-desktop">
          <NavLink to="/products" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} end>
            <Package size={16} />
            <span>Products</span>
          </NavLink>
          <a
            href="https://easystones.stoneprofitsweb.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="nav-link"
          >
            <Warehouse size={16} />
            <span>Live Inventory</span>
          </a>
          {user && user.type === 'internal' && (
            <NavLink to="/sales" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <TrendingUp size={16} />
              <span>Sales</span>
            </NavLink>
          )}
          <NavLink to="/warranty" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <ShieldCheck size={16} />
            <span>Warranty</span>
          </NavLink>
          <NavLink to="/contact" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <PhoneCall size={16} />
            <span>Contact Us</span>
          </NavLink>
        </nav>

        <div className="header-actions">
          {user ? (
            <div className="user-menu">
              <span className="logged-in-btn">{user.contactName}</span>
              <button onClick={handleLogout} className="logout-btn" aria-label="Logout">
                <LogOut size={18} />
              </button>
            </div>
          ) : (
            <Link to="/login" className="login-btn">
              Login
            </Link>
          )}
          <button
            className="icon-btn menu-btn"
            aria-label="Menu"
            onClick={toggleMobileMenu}
          >
            {isMobileMenuOpen ? (
              <X size={24} color={theme === 'light' ? '#0f172a' : '#ffffff'} />
            ) : (
              <Menu size={24} color={theme === 'light' ? '#0f172a' : '#ffffff'} />
            )}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {isMobileMenuOpen && (
        <nav className="nav-mobile">
          <NavLink
            to="/products"
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            end
            onClick={closeMobileMenu}
          >
            <Package size={18} />
            <span>Products</span>
          </NavLink>
          <a
            href="https://easystones.stoneprofitsweb.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="nav-link"
            onClick={closeMobileMenu}
          >
            <Warehouse size={18} />
            <span>Live Inventory</span>
          </a>
          {user && user.type === 'internal' && (
            <NavLink
              to="/sales"
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              onClick={closeMobileMenu}
            >
              <TrendingUp size={18} />
              <span>Sales</span>
            </NavLink>
          )}
          <NavLink
            to="/warranty"
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            onClick={closeMobileMenu}
          >
            <ShieldCheck size={18} />
            <span>Warranty</span>
          </NavLink>
          <NavLink
            to="/contact"
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            onClick={closeMobileMenu}
          >
            <PhoneCall size={18} />
            <span>Contact Us</span>
          </NavLink>

          {/* Login/Logout for Mobile */}
          {user ? (
            <button
              onClick={() => {
                handleLogout();
                closeMobileMenu();
              }}
              className="nav-link mobile-logout"
            >
              <LogOut size={18} />
              <span>Logout ({user.contactName})</span>
            </button>
          ) : (
            <Link
              to="/login"
              className="mobile-login-btn"
              onClick={closeMobileMenu}
            >
              Login
            </Link>
          )}
        </nav>
      )}
    </header>
  );
};

export default Header;
