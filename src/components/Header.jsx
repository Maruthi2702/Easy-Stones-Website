import { NavLink, Link } from 'react-router-dom';
import { Menu, LogOut, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useState } from 'react';
import './Header.css';

const Header = () => {
  const { user, logout } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
  };

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false);
  };

  return (
    <header className="header glass-panel">
      <div className="container header-content">
        <Link to="/" className="logo">
          <img src="/logo.png" alt="Easy Stones" className="logo-image" />
        </Link>

        <nav className="nav-desktop">
          <NavLink to="/" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} end>Products</NavLink>
          {user && <NavLink to="/sales" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>Sales</NavLink>}
          <NavLink to="/warranty" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>Warranty</NavLink>
          <NavLink to="/contact" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>Contact Us</NavLink>
        </nav>

        <div className="header-actions">
          {user ? (
            <div className="user-menu">
              <span className="user-name">{user.firstName}</span>
              <button onClick={handleLogout} className="logout-btn" aria-label="Logout">
                <LogOut size={18} />
              </button>
            </div>
          ) : (
            <Link to="/login" className="login-btn">
              Customer Login
            </Link>
          )}
          <button
            className="icon-btn menu-btn"
            aria-label="Menu"
            onClick={toggleMobileMenu}
          >
            {isMobileMenuOpen ? <X size={24} color="#fff" /> : <Menu size={24} color="#fff" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {isMobileMenuOpen && (
        <nav className="nav-mobile">
          <NavLink
            to="/"
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            end
            onClick={closeMobileMenu}
          >
            Products
          </NavLink>
          {user && (
            <NavLink
              to="/sales"
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              onClick={closeMobileMenu}
            >
              Sales
            </NavLink>
          )}
          <NavLink
            to="/warranty"
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            onClick={closeMobileMenu}
          >
            Warranty
          </NavLink>
          <NavLink
            to="/contact"
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            onClick={closeMobileMenu}
          >
            Contact Us
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
              Logout ({user.firstName})
            </button>
          ) : (
            <Link
              to="/login"
              className="mobile-login-btn"
              onClick={closeMobileMenu}
            >
              Customer Login
            </Link>
          )}
        </nav>
      )}
    </header>
  );
};

export default Header;
