import { NavLink, Link } from 'react-router-dom';
import { Menu, LogOut, X, ChevronDown } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useState, useRef, useEffect } from 'react';
import './Header.css';

const Header = () => {
  const { user, logout } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [salesDropdownOpen, setSalesDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  const handleLogout = async () => {
    await logout();
  };

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false);
    setSalesDropdownOpen(false);
  };

  const toggleSalesDropdown = () => {
    setSalesDropdownOpen(!salesDropdownOpen);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setSalesDropdownOpen(false);
      }
    };

    if (salesDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [salesDropdownOpen]);

  return (
    <header className="header glass-panel">
      <div className="container header-content">
        <Link to="/" className="logo">
          <img src="/logo.png" alt="Easy Stones" className="logo-image" />
        </Link>

        <nav className="nav-desktop">
          <NavLink to="/" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} end>Products</NavLink>
          {user && (
            <div className="dropdown" ref={dropdownRef}>
              <button
                className="nav-link dropdown-toggle"
                onClick={toggleSalesDropdown}
                aria-expanded={salesDropdownOpen}
              >
                Sales <ChevronDown size={16} className={`dropdown-icon ${salesDropdownOpen ? 'open' : ''}`} />
              </button>
              {salesDropdownOpen && (
                <div className="dropdown-menu">
                  <Link to="/sales" className="dropdown-item" onClick={() => setSalesDropdownOpen(false)}>Customers</Link>
                  <Link to="/sales/map" className="dropdown-item" onClick={() => setSalesDropdownOpen(false)}>Map</Link>
                </div>
              )}
            </div>
          )}
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
            <div className="mobile-dropdown">
              <button
                className="nav-link mobile-dropdown-toggle"
                onClick={toggleSalesDropdown}
              >
                Sales <ChevronDown size={16} className={`dropdown-icon ${salesDropdownOpen ? 'open' : ''}`} />
              </button>
              {salesDropdownOpen && (
                <div className="mobile-dropdown-menu">
                  <Link to="/sales" className="dropdown-item" onClick={closeMobileMenu}>Customers</Link>
                  <Link to="/sales/map" className="dropdown-item" onClick={closeMobileMenu}>Map</Link>
                </div>
              )}
            </div>
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
