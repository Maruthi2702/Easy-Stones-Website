import React, { useMemo } from 'react';
import ProductCard from './ProductCard';
import { products } from '../data/products';
import './ProductGrid.css';

const ProductGrid = ({ searchTerm = '' }) => {
  const filteredProducts = useMemo(() => {
    const trimmed = searchTerm.trim().toLowerCase();
    if (!trimmed) return products;
    return products.filter((product) => product.name.toLowerCase().startsWith(trimmed));
  }, [searchTerm]);

  return (
    <section className="product-section container">
      <div className="section-header">
        <h2 className="section-title">Moda Quartz</h2>
      </div>

      {filteredProducts.length === 0 ? (
        <div className="empty-state glass-panel">
          <p>No colors start with “{searchTerm}”. Try a different name.</p>
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
