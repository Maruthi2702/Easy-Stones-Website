import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Download, ZoomIn, Maximize2 } from 'lucide-react';
import { getLocalImagePath } from '../utils/imagePath';
import { API_URL } from '../config/api';
import { useAuth } from '../context/AuthContext';
import './ProductDetail.css';

const defaultDescription = (name) =>
  `${name} brings the luxurious movement of bespoke quartzite into a resilient quartz surface. Its dramatic veining and luminous base create the perfect canvas for contemporary kitchens, spa-like baths, and bespoke commercial installations.`;

const ProductDetail = () => {
  const navigate = useNavigate();
  const { productId } = useParams(); // This now contains the slug
  const location = useLocation();
  const { user } = useAuth();
  const [viewMode, setViewMode] = useState('slab'); // 'slab' | 'closeup'

  // Function to convert product name to slug
  const createSlug = (name) => name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');

  // Always start with loading state to ensure fresh price data
  // This prevents showing stale cached prices when customer price level changes
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProduct = async () => {
      try {
        const response = await fetch(`${API_URL}/api/products`, {
          credentials: 'include' // Send cookies with request
        });
        if (response.ok) {
          const data = await response.json();
          // Find by slug first, fallback to ID for backwards compatibility
          const found = data.find((item) =>
            createSlug(item.name) === productId || item.id.toString() === productId
          );
          if (found) {
            setProduct(found);
          }
        }
      } catch (error) {
        console.error('Error fetching product:', error);
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
              <span className={`tag ${product.availability === 'Out of Stock' ? 'out-of-stock' : 'available'}`}>
                {product.availability}
              </span>
            </div>

          </div>

          <div className="info-body">
            <p className="detail-description">{detail.description}</p>

            {/* Specs and Installed Images Grid */}
            <div className="specs-installed-grid">
              {/* Left Column: Specifications */}
              <div className="specs-column">
                {user && product.price && (
                  <div className="specs-list">
                    <h3>Price</h3>
                    <div className="pill-list">
                      <span className="pill price-pill">{product.price}</span>
                    </div>
                  </div>
                )}

                <div className="specs-list">
                  <h3>Thickness Options</h3>
                  <div className="pill-list">
                    {detail.thickness.map(t => <span key={t} className="pill">{t}</span>)}
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
                  <h3>Available Finishes</h3>
                  <div className="pill-list">
                    {detail.finishes.map(f => <span key={f} className="pill">{f}</span>)}
                  </div>
                </div>

                <div className="specs-list">
                  <h3>Applications</h3>
                  <div className="pill-list">
                    {detail.applications.map(a => <span key={a} className="pill">{a}</span>)}
                  </div>
                </div>
              </div>

              {/* Right Column: Installed Images */}
              <div className="installed-images-column">
                <h3>Installed Gallery</h3>
                <div className="installed-images-grid">
                  {[0, 1].map((index) => {
                    const img = product.installedImages && product.installedImages[index];
                    return img ? (
                      <div key={index} className="installed-image-card">
                        <img
                          src={img}
                          alt={`${product.name} installed view ${index + 1}`}
                          onClick={() => window.open(img, '_blank')}
                        />
                      </div>
                    ) : (
                      <div key={index} className="installed-placeholder">
                        <p>Installed image coming soon</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default ProductDetail;

