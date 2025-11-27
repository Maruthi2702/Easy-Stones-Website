import { NavLink, Link } from 'react-router-dom';
import { Menu, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import './Header.css';

const Header = () => {
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
  };

  return (
    <header className="header glass-panel">
      <div className="container header-content">
        <Link to="/" className="logo">
          <img src="/logo.png" alt="Easy Stones" className="logo-image" />
        </Link>

        <nav className="nav-desktop">
          <NavLink to="/" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} end>Products</NavLink>
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
              Login
            </Link>
          )}
          <button className="icon-btn menu-btn" aria-label="Menu">
            <Menu size={24} color="#000" />
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
