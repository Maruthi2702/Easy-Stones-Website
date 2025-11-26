import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { getLocalImagePath } from '../utils/imagePath';
import './ProductCard.css';

const ProductCard = ({ product, activeCategory }) => {
  const imageSrc = getLocalImagePath(product.image);

  return (
    <Link
      to={`/product/${product.id}`}
      className="product-card glass-panel"
      state={{ fromCategory: activeCategory }}
    >
      <div className="card-image-container">
        <img
          src={imageSrc}
          alt={product.name}
          className="card-image"
          loading="lazy"
          decoding="async"
        />
        {product.isNew && <span className="badge new">NEW</span>}
        <div className="card-overlay">
          <span className="view-btn">
            View Details <ArrowUpRight size={16} />
          </span>
        </div>
      </div>

      <div className="card-content">
        <div className="card-header">
          <span className="category">{product.category}</span>
          <span className={`availability ${product.availability.toLowerCase().replace(' ', '-')}`}>
            {product.availability}
          </span>
        </div>

        <h3 className="product-name">{product.name}</h3>
      </div>
    </Link>
  );
};

export default ProductCard;
