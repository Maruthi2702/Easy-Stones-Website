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
          <img src="/logo.png" alt="Easy Stones" className="logo-image" />
        </div>

        <nav className="nav-desktop">
          <a href="#" className="nav-link">Home</a>
          <a href="#" className="nav-link active">Products</a>
          <a href="#" className="nav-link">Live Inventory</a>
          <a href="#" className="nav-link">Blog</a>
          <a href="#" className="nav-link">Design Inspiration</a>
          <a href="#" className="nav-link">More</a>
        </nav>

        <div className="header-actions">
          <div className="search-container">
            <Search size={20} className="search-icon" />
            <input
              type="text"
              placeholder="Search products..."
              value={searchValue}
              onChange={handleSearchChange}
              className="search-input"
            />
          </div>
          <button className="icon-btn menu-btn" aria-label="Menu">
            <Menu size={24} color="#000" />
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
