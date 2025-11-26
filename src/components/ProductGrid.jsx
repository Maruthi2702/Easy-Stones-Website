import React, { useMemo, useState } from 'react';
import ProductCard from './ProductCard';
import { products } from '../data/products';
import './ProductGrid.css';

const ProductGrid = ({ searchTerm = '' }) => {
  const [activeCollection, setActiveCollection] = useState('All');

  const collections = ['All', 'Luxe', 'Prestige', 'Signature', 'Basic'];

  const filteredProducts = useMemo(() => {
    let filtered = products;

    // Filter by collection
    if (activeCollection !== 'All') {
      filtered = filtered.filter((product) => product.collection === activeCollection);
    }

    // Filter by search term
    const trimmed = searchTerm.trim().toLowerCase();
    if (trimmed) {
      filtered = filtered.filter((product) => product.name.toLowerCase().startsWith(trimmed));
    }

    // Sort alphabetically by name
    filtered = filtered.sort((a, b) => a.name.localeCompare(b.name));

    return filtered;
  }, [searchTerm, activeCollection]);

  return (
    <section className="product-section container">
      <div className="section-header">
        <h2 className="section-title">Moda Quartz</h2>
      </div>

      {/* Collection Tabs */}
      <div className="collection-tabs">
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

      {filteredProducts.length === 0 ? (
        <div className="empty-state glass-panel">
          <p>No products found{searchTerm ? ` starting with "${searchTerm}"` : ''} in {activeCollection} collection.</p>
        </div>
      ) : (
        <div className="product-grid">
          {filteredProducts.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </section>
  );
};

export default ProductGrid;
