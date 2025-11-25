import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Download } from 'lucide-react';
import { products } from '../data/products';
import { getLocalImagePath } from '../utils/imagePath';
import './ProductDetail.css';

const defaultDescription = (name) =>
  `${name} brings the luxurious movement of bespoke quartzite into a resilient quartz surface. Its dramatic veining and luminous base create the perfect canvas for contemporary kitchens, spa-like baths, and bespoke commercial installations.`;

const ProductDetail = () => {
  const navigate = useNavigate();
  const { productId } = useParams();
  const product = products.find((item) => item.id.toString() === productId);

  if (!product) {
    return (
      <section className="product-detail container">
        <button className="back-link" onClick={() => navigate('/')}>
          <ArrowLeft size={16} /> Back to collection
        </button>
        <div className="detail-error glass-panel">
          <p>This color is not available right now.</p>
        </div>
      </section>
    );
  }

  const heroImage = getLocalImagePath(product.image);
  const detail = {
    description: product.description ?? defaultDescription(product.name),
    thickness: product.thickness ?? ['1.5 CM', '2 CM', '3 CM'],
    finishes: product.finishes ?? ['Polished'],
    applications:
      product.applications ?? ['Countertops', 'Backsplash', 'Wall Cladding'],
    variations: product.variations ?? 'Low',
    style: product.style ?? 'Modern',
    primaryColor: product.primaryColor ?? product.category,
    accentColor: product.accentColor ?? 'Soft Veining',
    gallery: (product.gallery ?? [product.image]).map((src) => getLocalImagePath(src)),
  };

  return (
    <section className="product-detail container">
      <button className="back-link" onClick={() => navigate(-1)}>
        <ArrowLeft size={16} /> Back to colors
      </button>

      <div className="detail-hero glass-panel">
        <div className="detail-media">
          <img src={heroImage} alt={product.name} loading="lazy" />
        </div>
        <div className="detail-summary">
          <p className="detail-label">Quartz Color</p>
          <h1>{product.name}</h1>
          <p className="detail-description">{detail.description}</p>
          <div className="detail-tags">
            <span>{product.category}</span>
            <span>{product.availability}</span>
            <span>{detail.style}</span>
          </div>
          <div className="detail-cta">
            <a className="primary" href={heroImage} download>
              <Download size={16} /> Download cut sheet
            </a>
            <button className="secondary" onClick={() => navigate('/')}>
              View all colors <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </div>

      <div className="detail-grid">
        <div className="detail-card glass-panel">
          <h2>Product Info</h2>
          <dl>
            <div>
              <dt>Primary Color(s)</dt>
              <dd>{detail.primaryColor}</dd>
            </div>
            <div>
              <dt>Accent Color(s)</dt>
              <dd>{detail.accentColor}</dd>
            </div>
            <div>
              <dt>Available Finishes</dt>
              <dd>{detail.finishes.join(', ')}</dd>
            </div>
            <div>
              <dt>Thickness Options</dt>
              <dd>{detail.thickness.join(' · ')}</dd>
            </div>
            <div>
              <dt>Variations</dt>
              <dd>{detail.variations}</dd>
            </div>
          </dl>
        </div>

        <div className="detail-card glass-panel">
          <h2>Applications</h2>
          <ul>
            {detail.applications.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="muted">
            Rated for residential and commercial countertops, islands, accent
            walls, and vertical surfaces.
          </p>
        </div>

        <div className="detail-card glass-panel">
          <h2>Sizes</h2>
          <ul>
            {product.size.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
          <p className="muted">Prefabricated options available upon request.</p>
        </div>
      </div>

      <div className="detail-gallery">
        {detail.gallery.map((src, index) => (
          <div className="gallery-card glass-panel" key={`${src}-${index}`}>
            <img src={src} alt={`${product.name} view ${index + 1}`} />
          </div>
        ))}
      </div>
    </section>
  );
};

export default ProductDetail;

