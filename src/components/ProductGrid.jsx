import React, { useMemo, useState } from 'react';
import { Search, Filter, X } from 'lucide-react';
import ProductCard from './ProductCard';
import './ProductGrid.css';

const ProductGrid = ({ searchTerm = '', onSearchChange, activeCategory = 'Moda Quartz', products = [], loading = false }) => {
  const [activeCollection, setActiveCollection] = useState('All');
  const [showFilterModal, setShowFilterModal] = useState(false);

  const collections = ['All', 'Luxe', 'Prestige', 'Signature', 'Basic'];




  // Reset active collection when category changes
  React.useEffect(() => {
    setActiveCollection('All');
  }, [activeCategory]);

  const filteredProducts = useMemo(() => {
    let filtered = products;

    // Filter by Category
    if (activeCategory === 'Moda Quartz') {
      filtered = filtered.filter(p => p.category === 'Quartz');
    } else {
      filtered = filtered.filter(p => p.category === activeCategory);
    }

    // ... rest of logic


    // Filter by collection (only for Quartz/Moda Quartz for now)
    if (activeCategory === 'Moda Quartz' && activeCollection !== 'All') {
      filtered = filtered.filter((product) => product.collectionType === activeCollection);
    }

    // Filter by search term
    const trimmed = searchTerm.trim().toLowerCase();
    if (trimmed) {
      filtered = filtered.filter((product) => product.name.toLowerCase().startsWith(trimmed));
    }

    // Sort alphabetically by name
    filtered = filtered.sort((a, b) => a.name.localeCompare(b.name));

    return filtered;
  }, [searchTerm, activeCollection, activeCategory, products]);

  return (
    <section className="product-section container">
      {loading && (
        <div className="grid-loader">
          <div className="loader-spinner"></div>
        </div>
      )}

      {/* Collection Tabs with Search - Only show for Moda Quartz */}
      {/* Collection Tabs with Search - Only show for Moda Quartz */}
      {activeCategory === 'Moda Quartz' && (
        <div className="tabs-search-wrapper">
          {/* Desktop Collection Tabs */}
          <div className="collection-tabs desktop-only">
            {collections.map((collection) => (
              <button
                key={collection}
                className={`collection-tab ${activeCollection === collection ? 'active' : ''}`}
                onClick={() => setActiveCollection(collection)}
              >
                {collection}
              </button>
            ))}
          </div>

          {/* Mobile Filter Button */}
          <button
            className="filter-btn-mobile mobile-only"
            onClick={() => setShowFilterModal(true)}
          >
            <Filter size={20} />
            <span>Filters</span>
            {activeCollection !== 'All' && <span className="filter-badge">1</span>}
          </button>

          {/* Search Bar */}
          <div className="search-container-grid">
            <Search size={20} className="search-icon" />
            <input
              type="text"
              placeholder="Search products..."
              value={searchTerm}
              onChange={(e) => onSearchChange?.(e.target.value)}
              className="search-input"
            />
            {searchTerm && (
              <button
                className="search-clear-btn"
                onClick={() => onSearchChange?.('')}
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>
        </div>
      )}

      {/* Mobile Filter Modal */}
      {showFilterModal && (
        <div className="mobile-filter-overlay">
          <div className="mobile-filter-modal">
            <div className="filter-header">
              <h3>Filter Products</h3>
              <button className="close-filter-btn" onClick={() => setShowFilterModal(false)}>
                <X size={24} />
              </button>
            </div>
            <div className="filter-content">
              <h4>Collections</h4>
              <div className="filter-options">
                {collections.map((collection) => (
                  <button
                    key={collection}
                    className={`filter-option ${activeCollection === collection ? 'active' : ''}`}
                    onClick={() => {
                      setActiveCollection(collection);
                      setShowFilterModal(false);
                    }}
                  >
                    {collection}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Show search only when not Moda Quartz */}
      {activeCategory !== 'Moda Quartz' && (
        <div className="search-only-wrapper">
          <div className="search-container-grid">
            <Search size={20} className="search-icon" />
            <input
              type="text"
              placeholder="Search products..."
              value={searchTerm}
              onChange={(e) => onSearchChange?.(e.target.value)}
              className="search-input"
            />
          </div>
        </div>
      )}


      {/* Product Grid */}
      <div className="product-grid">
        {filteredProducts.length > 0 ? (
          filteredProducts.map((product) => (
            <ProductCard key={product.id} product={product} activeCategory={activeCategory} />
          ))
        ) : (
          !loading && (
            <div className="coming-soon-container">
              <h2 className="coming-soon-text">Coming Soon!!</h2>
              <p className="coming-soon-subtext">We are currently updating our {activeCategory} inventory. Please check back later!</p>
            </div>
          )
        )}
      </div>
    </section>
  );
};

export default ProductGrid;
