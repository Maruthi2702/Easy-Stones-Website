import React from 'react';
import { ShoppingBag, Menu, Search } from 'lucide-react';
import './Header.css';

const Header = ({ searchValue, onSearchChange }) => {
  const handleSearchChange = (event) => {
    onSearchChange?.(event.target.value);
  };

  return (
    <header className="header glass-panel">
      <div className="container header-content">
        <div className="logo">
          <span className="logo-icon">
            <ShoppingBag size={24} color="#5de0e6" />
          </span>
          <div className="logo-copy">
            <h1 className="logo-text">EASY STONES</h1>
            <p className="logo-subtitle">YOUR GLOBAL DESIGN SOURCE</p>
          </div>
        </div>

        <nav className="nav-desktop">
          <a href="#" className="nav-link active">New Arrivals</a>
          <a href="#" className="nav-link">Collections</a>
          <a href="#" className="nav-link">Accessories</a>
          <a href="#" className="nav-link">Sale</a>
        </nav>

        <div className="header-actions">
          <div className="header-search glass-panel">
            <Search size={18} />
            <input
              type="text"
              placeholder="Search colors by name…"
              value={searchValue}
              onChange={handleSearchChange}
              aria-label="Search colors by name"
            />
          </div>
          <button className="icon-btn menu-btn" aria-label="Menu">
            <Menu size={20} />
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
