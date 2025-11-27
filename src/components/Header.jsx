import { NavLink, Link } from 'react-router-dom';
import { Menu } from 'lucide-react';
import './Header.css';

const Header = () => {
  return (
    <header className="header glass-panel">
      <div className="container header-content">
        <Link to="/" className="logo">
          <img src="/logo.png" alt="Easy Stones" className="logo-image" />
        </Link>

        <nav className="nav-desktop">
          <NavLink to="/" className="nav-link" end>Products</NavLink>
          <NavLink to="/contact" className="nav-link">Contact Us</NavLink>
        </nav>

        <div className="header-actions">
          <button className="icon-btn menu-btn" aria-label="Menu">
            <Menu size={24} color="#000" />
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
