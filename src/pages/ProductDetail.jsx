import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Download, ZoomIn, Maximize2, X, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
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

  // Lightbox State
  const [showLightbox, setShowLightbox] = useState(false);
  const [currentBundle, setCurrentBundle] = useState(null);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  // Function to convert product name to slug
  const createSlug = (name) => name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');

  // Initialize with passed product state if available for instant render
  const initialProduct = location.state?.product;

  const [product, setProduct] = useState(initialProduct || null);
  const [loading, setLoading] = useState(!initialProduct);
  const [error, setError] = useState(null);

  useEffect(() => {
    // If we have an initial product, we can still fetch to ensure we have the latest data
    // but we don't need to show a loader
    const fetchProduct = async () => {
      try {
        if (!initialProduct) setLoading(true);

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
            setError(null);
          } else if (!product) {
            // Only set error if we don't have a product already (and couldn't find one)
            console.error(`Product not found for ID/Slug: ${productId}`);
            setError(`Product not found: ${productId}`);
          }
        } else {
          console.error('Failed to fetch products API');
        }
      } catch (error) {
        console.error('Error fetching product:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchProduct();
  }, [productId, initialProduct]);

  // Get category from location state or fallback to product category or default
  const backCategory = location.state?.fromCategory;

  const handleBack = () => {
    if (backCategory) {
      navigate('/', { state: { activeCategory: backCategory } });
    } else {
      navigate(-1);
    }
  };

  const openLightbox = (bundle, index = 0) => {
    setCurrentBundle(bundle);
    setCurrentImageIndex(index);
    setShowLightbox(true);
    document.body.style.overflow = 'hidden';
  };

  const closeLightbox = () => {
    setShowLightbox(false);
    setCurrentBundle(null);
    document.body.style.overflow = 'auto';
  };

  const nextImage = (e) => {
    e.stopPropagation();
    if (currentBundle && currentBundle.images) {
      setCurrentImageIndex((prev) => (prev + 1) % currentBundle.images.length);
    }
  };

  const prevImage = (e) => {
    e.stopPropagation();
    if (currentBundle && currentBundle.images) {
      setCurrentImageIndex((prev) => (prev - 1 + currentBundle.images.length) % currentBundle.images.length);
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
          {error && <p className="debug-error" style={{ fontSize: '0.8em', marginTop: '10px', opacity: 0.7 }}>{error}</p>}
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
        <div className={`product-info ${['Quartzite', 'Granite', 'Marble'].includes(product.category) ? 'full-width-info' : ''}`}>
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

            <div className="specs-installed-grid" style={product.bundles && product.bundles.length > 0 ? { display: 'flex', flexDirection: 'column', gap: '2rem' } : {}}>
              {/* Conditional Layout: Hide Specs if Bundle Product */}
              {!(product.bundles && product.bundles.length > 0) && (
                <div className="specs-container">
                  <div className="specs-header-box">
                    <h3>Specs</h3>
                  </div>
                  <div className="specs-table">
                    {user && product.price && (
                      <div className="spec-row">
                        <span className="spec-label">Price</span>
                        <span className="spec-value highlight">{product.price}</span>
                      </div>
                    )}
                    <div className="spec-row">
                      <span className="spec-label">Thickness</span>
                      <span className="spec-value">{detail.thickness.join(', ')}</span>
                    </div>
                    <div className="spec-row">
                      <span className="spec-label">Sizes</span>
                      <span className="spec-value">
                        {product.sizes && product.sizes.length > 0
                          ? product.sizes.join(' | ')
                          : 'Contact for sizes'}
                      </span>
                    </div>
                    <div className="spec-row">
                      <span className="spec-label">Book Match</span>
                      <span className="spec-value">{product.bookMatch || 'N/A'}</span>
                    </div>
                    <div className="spec-row">
                      <span className="spec-label">Finishes</span>
                      <span className="spec-value">{detail.finishes.join(', ')}</span>
                    </div>
                    <div className="spec-row">
                      <span className="spec-label">Applications</span>
                      <span className="spec-value">{detail.applications.join(', ')}</span>
                    </div>
                    <div className="spec-row">
                      <span className="spec-label">Variations</span>
                      <span className="spec-value">{detail.variations}</span>
                    </div>
                    <div className="spec-row">
                      <span className="spec-label">Style</span>
                      <span className="spec-value">{detail.style}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Right Column / Full Width: Installed Images / Bundles */}
              <div className="installed-images-column" style={product.bundles && product.bundles.length > 0 ? { width: '100%' } : {}}>
                {product.bundles && product.bundles.length > 0 ? (
                  <>
                    <h3 style={{
                      borderBottom: '1px solid rgba(255,255,255,0.1)',
                      paddingBottom: '1rem',
                      fontSize: '1.2rem',
                      letterSpacing: '0.1em',
                      marginBottom: '1rem'
                    }}>
                      AVAILABLE INVENTORY
                    </h3>
                    <div className="bundle-grid" style={{
                      gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                      gap: '2.5rem'
                    }}>
                      {product.bundles.map((bundle, bIndex) => (
                        <div key={bIndex} className="bundle-card">
                          <img
                            src={getLocalImagePath(bundle.images?.[0])}
                            alt={`Bundle ${bundle.bundleNumber}`}
                            className="bundle-thumbnail"
                            onClick={() => openLightbox(bundle, 0)}
                          />
                          <div className="bundle-info">
                            <div className="bundle-meta-row">
                              <span>Bundle Num:</span>
                              <strong>{bundle.bundleNumber}</strong>
                            </div>
                            <div className="bundle-meta-row">
                              <span>Avg Size:</span>
                              <strong>{bundle.avgSize || 'N/A'}</strong>
                            </div>
                            <div className="bundle-meta-row">
                              <span>Location:</span>
                              <strong>{bundle.location || 'N/A'}</strong>
                            </div>

                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <h3>{['Quartzite', 'Granite', 'Marble'].includes(product.category) ? 'Bundle Gallery' : 'Installed Gallery'}</h3>
                    <div className="installed-images-grid">
                      {[0, 1].map((index) => {
                        const img = product.installedImages && product.installedImages[index];
                        return img ? (
                          <div key={index} className="installed-image-card">
                            <img
                              src={getLocalImagePath(img)}
                              alt={`${product.name} installed view ${index + 1}`}
                              onClick={() => window.open(getLocalImagePath(img), '_blank')}
                            />
                          </div>
                        ) : (
                          <div key={index} className="installed-placeholder">
                            <p>Installed image coming soon</p>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Lightbox Overlay */}
      {showLightbox && currentBundle && (
        <div className="lightbox-overlay" onClick={closeLightbox}>
          <button className="lightbox-close" onClick={closeLightbox}>
            <X size={32} />
          </button>

          <button className="lightbox-nav-btn prev" onClick={prevImage}>
            <ChevronLeft size={32} />
          </button>

          <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
            <img
              src={getLocalImagePath(currentBundle.images[currentImageIndex])}
              alt={`Bundle ${currentBundle.bundleNumber} View`}
              className="lightbox-image"
            />
          </div>

          <button className="lightbox-nav-btn next" onClick={nextImage}>
            <ChevronRight size={32} />
          </button>

          <div className="lightbox-footer" onClick={(e) => e.stopPropagation()}>
            <div className="lightbox-meta-item">
              <strong>Bundle Num:</strong> {currentBundle.bundleNumber}
            </div>
            <div className="lightbox-meta-item">
              <strong>Avg Size:</strong> {currentBundle.avgSize || 'N/A'}
            </div>
            <div className="lightbox-meta-item">
              <strong>Location:</strong> {currentBundle.location || 'N/A'}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default ProductDetail;

