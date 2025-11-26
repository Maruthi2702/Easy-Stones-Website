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
          <a href="#" className="nav-link">Home</a>
          <a href="#" className="nav-link active">Products</a>
          <a href="#" className="nav-link">Live Inventory</a>
          <a href="#" className="nav-link">Blog</a>
          <a href="#" className="nav-link">Design Inspiration</a>
          <a href="#" className="nav-link">More</a>
        </nav>

        <div className="header-actions">
          <button className="request-quote-btn">Request Quote</button>
          <button className="icon-btn menu-btn" aria-label="Menu">
            <Menu size={24} color="#000" />
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
