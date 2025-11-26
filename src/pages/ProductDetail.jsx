import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Download, ZoomIn, Maximize2 } from 'lucide-react';
import { getLocalImagePath } from '../utils/imagePath';
import { API_URL } from '../config/api';
import { products as fallbackProducts } from '../data/products';
import './ProductDetail.css';

const defaultDescription = (name) =>
  `${name} brings the luxurious movement of bespoke quartzite into a resilient quartz surface. Its dramatic veining and luminous base create the perfect canvas for contemporary kitchens, spa-like baths, and bespoke commercial installations.`;

const ProductDetail = () => {
  const navigate = useNavigate();
  const { productId } = useParams();
  const location = useLocation();
  const [viewMode, setViewMode] = useState('slab'); // 'slab' | 'closeup'
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProduct = async () => {
      try {
        // First try to find in fallback data to show something immediately if possible (optional)
        // or just fetch from API.

        const response = await fetch(`${API_URL}/api/products`);
        if (response.ok) {
          const data = await response.json();
          const found = data.find((item) => item.id.toString() === productId);
          if (found) {
            setProduct(found);
          } else {
            // Fallback to local data if not found in API (e.g. API empty)
            const localFound = fallbackProducts.find((item) => item.id.toString() === productId);
            setProduct(localFound);
          }
        } else {
          const localFound = fallbackProducts.find((item) => item.id.toString() === productId);
          setProduct(localFound);
        }
      } catch (error) {
        console.error('Error fetching product:', error);
        const localFound = fallbackProducts.find((item) => item.id.toString() === productId);
        setProduct(localFound);
      } finally {
        setLoading(false);
      }
    };

    fetchProduct();
  }, [productId]);

  // Get category from location state or fallback to product category or default
  const backCategory = location.state?.fromCategory;

  const handleBack = () => {
    if (backCategory) {
      navigate('/', { state: { activeCategory: backCategory } });
    } else {
      navigate(-1);
    }
  };

  if (loading) {
    return (
      <div className="page-loader">
        <div className="loader-spinner"></div>
      </div>
    );
  }

  if (!product) {
    return (
      <section className="product-detail container">
        <button className="back-link" onClick={handleBack}>
          <ArrowLeft size={16} /> Back to collection
        </button>
        <div className="detail-error glass-panel">
          <p>This color is not available right now.</p>
        </div>
      </section>
    );
  }

  const heroImage = getLocalImagePath(product.image);
  // ... rest of detail object ...
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
  };

  return (
    <section className="product-detail container">
      <div className="product-layout">
        {/* Visuals Section */}
        <div className="product-visuals">
          <button className="back-link" onClick={handleBack}>
            <ArrowLeft size={16} /> Back
          </button>

          <div className={`main-image-container ${viewMode}`}>
            <img
              src={heroImage}
              alt={product.name}
              className={`main-image ${viewMode === 'closeup' ? 'zoomed' : ''}`}
            />
          </div>

          <div className="view-toggles">
            <button
              className={`toggle-btn ${viewMode === 'slab' ? 'active' : ''}`}
              onClick={() => setViewMode('slab')}
            >
              <Maximize2 size={18} /> Full Slab
            </button>
            <button
              className={`toggle-btn ${viewMode === 'closeup' ? 'active' : ''}`}
              onClick={() => setViewMode('closeup')}
            >
              <ZoomIn size={18} /> Close Up
            </button>
          </div>
        </div>

        {/* Info Section */}
        <div className="product-info">
          <div className="info-header">
            <p className="detail-label">Quartz Color</p>
            <h1>{product.name}</h1>
            <div className="detail-tags">
              <span className="tag">{product.category}</span>
              <span className="tag available">{product.availability}</span>
            </div>
          </div>

          <div className="info-body">
            <p className="detail-description">{detail.description}</p>

            <div className="specs-grid">
              <div className="spec-item">
                <span className="spec-label">Primary Color</span>
                <span className="spec-value">{detail.primaryColor}</span>
              </div>
              <div className="spec-item">
                <span className="spec-label">Accent Color</span>
                <span className="spec-value">{detail.accentColor}</span>
              </div>
              <div className="spec-item">
                <span className="spec-label">Style</span>
                <span className="spec-value">{detail.style}</span>
              </div>
              <div className="spec-item">
                <span className="spec-label">Variations</span>
                <span className="spec-value">{detail.variations}</span>
              </div>
            </div>

            <div className="specs-row">
              <div className="specs-list">
                <h3>Available Finishes</h3>
                <div className="pill-list">
                  {detail.finishes.map(f => <span key={f} className="pill">{f}</span>)}
                </div>
              </div>

              <div className="specs-list">
                <h3>Thickness Options</h3>
                <div className="pill-list">
                  {detail.thickness.map(t => <span key={t} className="pill">{t}</span>)}
                </div>
              </div>
            </div>

            <div className="specs-list">
              <h3>Size Options</h3>
              <div className="pill-list">
                {(product.sizes && product.sizes.length > 0)
                  ? product.sizes.map(s => <span key={s} className="pill">{s}</span>)
                  : <span className="pill">Contact for sizes</span>
                }
              </div>
            </div>

            <div className="specs-list">
              <h3>Applications</h3>
              <div className="pill-list">
                {detail.applications.map(a => <span key={a} className="pill">{a}</span>)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default ProductDetail;

