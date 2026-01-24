import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { getLocalImagePath } from '../utils/imagePath';
import './ProductCard.css';

const ProductCard = ({ product, activeCategory }) => {
  const imageSrc = getLocalImagePath(product.image);

  // Convert product name to URL-friendly slug
  const productSlug = product.name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');

  return (
    <Link
      to={`/product/${productSlug}`}
      className="product-card minimalist"
      state={{ fromCategory: activeCategory, productId: product.id, product: product }}
    >
      <div className="card-image-container">
        <img
          src={imageSrc}
          alt={product.name}
          className="card-image"
          loading="lazy"
          decoding="async"
        />
        {product.isNewArrival && <span className="minimal-badge">NEW</span>}
      </div>

      <div className="card-footer">
        <h3 className="product-name">{product.name}</h3>
      </div>
    </Link>
  );
};

export default ProductCard;
