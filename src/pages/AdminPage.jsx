import React, { useState } from 'react';
import { products as initialProducts } from '../data/products';
import './AdminPage.css';

const AdminPage = () => {
  // Initialize products with thickness and sizes if they don't exist
  const [products, setProducts] = useState(
    initialProducts.map(p => ({
      ...p,
      thickness: p.thickness || [],
      sizes: p.sizes || []
    }))
  );
  const [saveStatus, setSaveStatus] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  const collections = ['Luxe', 'Prestige', 'Signature', 'Basic'];
  const categories = ['Quartz', 'Granite', 'Marble', 'Quartzite'];
  const thicknessOptions = ['1.5CM', '2CM', '3CM'];
  const sizeOptions = ['126 * 63', '135 * 77', '136 * 78', '138 * 79', '139 * 80', '143 * 80'];

  const handleCollectionChange = (productId, newCollection) => {
    setProducts(prevProducts =>
      prevProducts.map(product =>
        product.id === productId
          ? { ...product, collection: newCollection }
          : product
      )
    );
  };

  const handlePriceChange = (productId, newPrice) => {
    setProducts(prevProducts =>
      prevProducts.map(product =>
        product.id === productId
          ? { ...product, price: newPrice }
          : product
      )
    );
  };

  const handleCategoryChange = (productId, newCategory) => {
    setProducts(prevProducts =>
      prevProducts.map(product =>
        product.id === productId
          ? { ...product, category: newCategory }
          : product
      )
    );
  };

  const handleThicknessChange = (productId, thickness) => {
    setProducts(prevProducts =>
      prevProducts.map(product => {
        if (product.id === productId) {
          const currentThickness = product.thickness || [];
          const newThickness = currentThickness.includes(thickness)
            ? currentThickness.filter(t => t !== thickness)
            : [...currentThickness, thickness];
          return { ...product, thickness: newThickness };
        }
        return product;
      })
    );
  };

  const handleSizeChange = (productId, size) => {
    setProducts(prevProducts =>
      prevProducts.map(product => {
        if (product.id === productId) {
          const currentSizes = product.sizes || [];
          const newSizes = currentSizes.includes(size)
            ? currentSizes.filter(s => s !== size)
            : [...currentSizes, size];
          return { ...product, sizes: newSizes };
        }
        return product;
      })
    );
  };

  const handleAvailabilityChange = (productId, newAvailability) => {
    setProducts(prevProducts =>
      prevProducts.map(product =>
        product.id === productId
          ? { ...product, availability: newAvailability }
          : product
      )
    );
  };


  const saveChanges = async () => {
    setIsSaving(true);
    setSaveStatus(null);

    try {
      const response = await fetch('http://localhost:3001/api/products/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ products }),
      });

      if (!response.ok) {
        throw new Error('Failed to save products');
      }

      const data = await response.json();
      setSaveStatus('success');
      console.log('✅ Products saved:', data);

      setTimeout(() => setSaveStatus(null), 3000);
    } catch (error) {
      console.error('❌ Error saving products:', error);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus(null), 5000);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="admin-page">
      <div className="container">
        <div className="admin-header">
          <h1 className="admin-title">Collection Management</h1>
          <p className="admin-subtitle">Manage product collections, prices, categories, thickness, and sizes</p>
        </div>

        <div className="admin-actions">
          <button
            className={`save-btn ${isSaving ? 'saving' : ''}`}
            onClick={saveChanges}
            disabled={isSaving}
          >
            <span className="icon">{isSaving ? '⏳' : '💾'}</span>
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>

        {saveStatus === 'success' && (
          <div className="status-message success">
            ✅ Changes saved successfully! Refresh the main page to see updates.
          </div>
        )}

        {saveStatus === 'error' && (
          <div className="status-message error">
            ❌ Failed to save changes. Make sure the backend server is running.
          </div>
        )}

        <div className="products-table-container">
          <table className="products-table">
            <thead>
              <tr>
                <th>Image</th>
                <th>Product Name</th>
                <th>Price</th>
                <th>Category</th>
                <th>Collection</th>
                <th>Availability</th>
                <th>Thickness</th>
                <th>Sizes</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id}>
                  <td>
                    <img
                      src={product.image}
                      alt={product.name}
                      className="product-thumbnail"
                    />
                  </td>
                  <td className="product-name">{product.name}</td>
                  <td>
                    <input
                      type="text"
                      value={product.price}
                      onChange={(e) => handlePriceChange(product.id, e.target.value)}
                      className="price-input"
                    />
                  </td>
                  <td>
                    <select
                      value={product.category}
                      onChange={(e) => handleCategoryChange(product.id, e.target.value)}
                      className="category-select"
                    >
                      {categories.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      value={product.collection}
                      onChange={(e) => handleCollectionChange(product.id, e.target.value)}
                      className="collection-select"
                    >
                      {collections.map((collection) => (
                        <option key={collection} value={collection}>
                          {collection}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      value={product.availability || 'In Stock'}
                      onChange={(e) => handleAvailabilityChange(product.id, e.target.value)}
                      className="availability-select"
                    >
                      <option value="In Stock">In Stock</option>
                      <option value="Out of Stock">Out of Stock</option>
                    </select>
                  </td>
                  <td>
                    <div className="checkbox-group">
                      {thicknessOptions.map((thickness) => (
                        <label key={thickness} className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={(product.thickness || []).includes(thickness)}
                            onChange={() => handleThicknessChange(product.id, thickness)}
                          />
                          <span>{thickness}</span>
                        </label>
                      ))}
                    </div>
                  </td>
                  <td>
                    <div className="checkbox-group">
                      {sizeOptions.map((size) => (
                        <label key={size} className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={(product.sizes || []).includes(size)}
                            onChange={() => handleSizeChange(product.id, size)}
                          />
                          <span>{size}</span>
                        </label>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AdminPage;
