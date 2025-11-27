import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Save, Search, Image as ImageIcon, ArrowLeft, LogOut, Settings, Package, Users, User } from 'lucide-react';
import { API_ENDPOINTS, API_URL } from '../config/api';
import { products as fallbackProducts } from '../data/products';
import './AdminPage.css';

const AdminPage = () => {
  const navigate = useNavigate();
  // Initialize with fallback data immediately
  const [products, setProducts] = useState(fallbackProducts);
  const [selectedProductId, setSelectedProductId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('All');
  const [filterCollection, setFilterCollection] = useState('All');
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('products');
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [passwordStatus, setPasswordStatus] = useState(null);

  // Customer Management State
  const [customers, setCustomers] = useState([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);
  const [customerSearchTerm, setCustomerSearchTerm] = useState('');
  const [customerFormData, setCustomerFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    phone: '',
    company: '',
    address: {
      street: '',
      city: '',
      state: '',
      zipCode: ''
    }
  });
  const [isNewCustomer, setIsNewCustomer] = useState(false);
  const [customerSaveStatus, setCustomerSaveStatus] = useState(null);

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const response = await fetch(`${API_URL}/api/products`);
        if (response.ok) {
          const data = await response.json();
          if (data && data.length > 0 && data[0].collection) {
            setProducts(data);
          }
        }
      } catch (error) {
        console.error('Error fetching products:', error);
      } finally {
        setLoading(false);
      }
    };

    const fetchCustomers = async () => {
      try {
        const response = await fetch(`${API_URL}/api/admin/customers`, {
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include'
        });
        if (response.ok) {
          const data = await response.json();
          setCustomers(data);
        }
      } catch (error) {
        console.error('Error fetching customers:', error);
      }
    };

    fetchProducts();
    if (activeTab === 'customers') {
      fetchCustomers();
    }
  }, [activeTab]);

  // Initialize selected product when products change or on first load
  const selectedProduct = products.find(p => p.id === selectedProductId);

  // Filter products for sidebar
  const filteredProducts = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = filterCategory === 'All' || p.category === filterCategory;
    const matchesCollection = filterCollection === 'All' || p.collection === filterCollection;
    return matchesSearch && matchesCategory && matchesCollection;
  }).sort((a, b) => a.name.localeCompare(b.name));

  const handleSelectProduct = (id) => {
    setSelectedProductId(id);
    setSaveStatus(null);
    window.scrollTo(0, 0);
  };

  const handleAddProduct = () => {
    const newId = Math.max(...products.map(p => p.id), 0) + 1;
    const newProduct = {
      id: newId,
      name: 'New Product',
      category: 'Quartz',
      price: '$0.00/sqft',
      collection: 'Basic',
      availability: 'In Stock',
      image: '/images/products/placeholder.jpg',
      isNewArrival: true,
      showInSlider: false,
      thickness: ['3CM'],
      sizes: [],
      description: '',
      primaryColor: '',
      accentColor: '',
      style: '',
      variations: 'Low',
      finishes: ['Polished'],
      applications: ['Countertops', 'Backsplash', 'Wall Cladding']
    };

    setProducts([newProduct, ...products]);
    setSelectedProductId(newId);
    setSaveStatus({ type: 'info', message: 'New product created. Fill in details and save.' });
  };

  const handleDeleteProduct = (id) => {
    if (window.confirm('Are you sure you want to delete this product? This cannot be undone.')) {
      const newProducts = products.filter(p => p.id !== id);
      setProducts(newProducts);
      if (selectedProductId === id) {
        setSelectedProductId(null);
      }
      saveData(newProducts); // Auto-save on delete
    }
  };

  const handleChange = (field, value) => {
    if (!selectedProduct) return;

    setProducts(prev => prev.map(p =>
      p.id === selectedProductId ? { ...p, [field]: value } : p
    ));
  };

  const handleArrayChange = (field, value, isChecked) => {
    if (!selectedProduct) return;

    const currentArray = selectedProduct[field] || [];
    let newArray;

    if (isChecked) {
      newArray = [...currentArray, value];
    } else {
      newArray = currentArray.filter(item => item !== value);
    }

    handleChange(field, newArray);
  };

  const saveData = async (productsToSave = products) => {
    setIsSaving(true);
    setSaveStatus(null);

    try {
      const response = await fetch(API_ENDPOINTS.SAVE_PRODUCTS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ products: productsToSave }),
      });

      const data = await response.json();

      if (data.success) {
        setSaveStatus({ type: 'success', message: 'Changes saved successfully!' });
        setTimeout(() => setSaveStatus(null), 3000);
      } else {
        throw new Error(data.details || data.error || 'Failed to save');
      }
    } catch (error) {
      console.error('Error saving:', error);
      setSaveStatus({ type: 'error', message: `Failed to save: ${error.message}` });
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch(`${API_URL}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include'
      });
      navigate('/admin/login');
    } catch (error) {
      console.error('Logout error:', error);
      navigate('/admin/login');
    }
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setPasswordStatus(null);

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setPasswordStatus({ type: 'error', message: 'New passwords do not match' });
      return;
    }

    if (passwordData.newPassword.length < 6) {
      setPasswordStatus({ type: 'error', message: 'Password must be at least 6 characters' });
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          currentPassword: passwordData.currentPassword,
          newPassword: passwordData.newPassword
        })
      });

      const data = await response.json();

      if (response.ok) {
        setPasswordStatus({ type: 'success', message: 'Password changed successfully!' });
        setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
        setTimeout(() => setPasswordStatus(null), 3000);
      } else {
        setPasswordStatus({ type: 'error', message: data.message || 'Failed to change password' });
      }
    } catch (error) {
      console.error('Password change error:', error);
      setPasswordStatus({ type: 'error', message: 'Failed to change password' });
    }
  };

  // Options
  const collections = ['Luxe', 'Prestige', 'Signature', 'Basic'];
  const categories = ['Quartz', 'Granite', 'Marble', 'Quartzite', 'MODA PST'];
  const thicknessOptions = ['1.5CM', '2CM', '3CM'];

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('image', file);

    try {
      const response = await fetch(API_ENDPOINTS.UPLOAD, {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();

      if (data.success) {
        handleChange('image', data.filePath);
      } else {
        alert('Failed to upload image');
      }
    } catch (error) {
      console.error('Error uploading image:', error);
      alert('Error uploading image');
    }
  };
  const sizeOptions = ['126 * 63', '135 * 77', '136 * 78', '138 * 79', '139 * 80', '143 * 80'];
  const finishOptions = ['Polished', 'Honed', 'Leathered', 'Concrete'];
  const applicationOptions = ['Countertops', 'Backsplash', 'Wall Cladding', 'Flooring', 'Shower Walls'];



  return (
    <div className="admin-container">
      {/* Admin Header */}
      <div className="admin-header">
        <div className="admin-header-content">
          <h1>Admin Panel</h1>
          <div className="header-tabs">
            <button
              className={`tab-btn ${activeTab === 'products' ? 'active' : ''}`}
              onClick={() => setActiveTab('products')}
            >
              <Package size={18} />
              Products
            </button>
            <button
              className={`tab-btn ${activeTab === 'customers' ? 'active' : ''}`}
              onClick={() => setActiveTab('customers')}
            >
              <Users size={18} />
              Customers
            </button>
            <button
              className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={() => setActiveTab('settings')}
            >
              <Settings size={18} />
              Settings
            </button>
          </div>
          <button className="logout-btn" onClick={handleLogout}>
            <LogOut size={18} />
            Logout
          </button>
        </div>
      </div>

      {/* Sidebar */}
      {activeTab === 'products' && (
        <div className="admin-sidebar">
          <div className="sidebar-header">
            <h2>Products</h2>
            <button className="add-btn" onClick={handleAddProduct}>
              <Plus size={18} /> New
            </button>
          </div>

          <div className="search-box">
            <Search size={16} className="search-icon" />
            <input
              type="text"
              placeholder="Search products..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="filter-box">
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="sidebar-filter"
            >
              <option value="All">All Categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select
              value={filterCollection}
              onChange={(e) => setFilterCollection(e.target.value)}
              className="sidebar-filter"
            >
              <option value="All">All Collections</option>
              {collections.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className="product-list">
            {filteredProducts.map(product => (
              <div
                key={product.id}
                className={`product-list-item ${selectedProductId === product.id ? 'active' : ''}`}
                onClick={() => handleSelectProduct(product.id)}
              >
                <img src={product.image} alt={product.name} className="list-thumb" />
                <div className="list-info">
                  <span className="list-name">{product.name}</span>
                  <span className="list-meta">{product.collection} • {product.category}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'customers' && (
        <div className="admin-sidebar">
          <div className="sidebar-header">
            <h2>Customers</h2>
            <button className="add-btn" onClick={handleAddCustomer}>
              <Plus size={18} /> New
            </button>
          </div>

          <div className="search-box">
            <Search size={16} className="search-icon" />
            <input
              type="text"
              placeholder="Search customers..."
              value={customerSearchTerm}
              onChange={(e) => setCustomerSearchTerm(e.target.value)}
            />
          </div>

          <div className="product-list">
            {filteredCustomers.map(customer => (
              <div
                key={customer._id}
                className={`product-list-item ${selectedCustomerId === customer._id ? 'active' : ''}`}
                onClick={() => handleSelectCustomer(customer)}
              >
                <div className="list-thumb-placeholder">
                  <User size={20} />
                </div>
                <div className="list-info">
                  <span className="list-name">{customer.firstName} {customer.lastName}</span>
                  <span className="list-meta">{customer.company || customer.email}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className={`admin-main ${activeTab === 'settings' ? 'full-width' : ''}`}>
        <div className="main-header">
          <h1>Product Editor</h1>
          <div className="header-actions">
            {selectedProduct && (
              <button
                className="delete-btn"
                onClick={() => handleDeleteProduct(selectedProduct.id)}
              >
                <Trash2 size={18} /> Delete
              </button>
            )}
            <button
              className={`save-btn ${isSaving ? 'saving' : ''}`}
              onClick={() => saveData()}
              disabled={isSaving}
            >
              <Save size={18} /> {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>

        {saveStatus && (
          <div className={`status-message ${saveStatus.type}`}>
            {saveStatus.message}
          </div>
        )}

        {activeTab === 'customers' ? (
          selectedCustomerId ? (
            <div className="edit-form">
              <div className="main-header">
                <h1>{isNewCustomer ? 'Create Customer' : 'Edit Customer'}</h1>
                <div className="header-actions">
                  <button
                    className={`save-btn ${isSaving ? 'saving' : ''}`}
                    onClick={saveCustomer}
                    disabled={isSaving}
                  >
                    <Save size={18} /> {isSaving ? 'Saving...' : 'Save Customer'}
                  </button>
                </div>
              </div>

              {customerSaveStatus && (
                <div className={`status-message ${customerSaveStatus.type}`}>
                  {customerSaveStatus.message}
                </div>
              )}

              <form onSubmit={saveCustomer} className="customer-form">
                <section className="form-section">
                  <h3>Personal Information</h3>
                  <div className="form-grid">
                    <div className="form-group">
                      <label>First Name</label>
                      <input
                        type="text"
                        value={customerFormData.firstName}
                        onChange={(e) => handleCustomerChange('firstName', e.target.value)}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>Last Name</label>
                      <input
                        type="text"
                        value={customerFormData.lastName}
                        onChange={(e) => handleCustomerChange('lastName', e.target.value)}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>Email</label>
                      <input
                        type="email"
                        value={customerFormData.email}
                        onChange={(e) => handleCustomerChange('email', e.target.value)}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>Phone</label>
                      <input
                        type="tel"
                        value={customerFormData.phone}
                        onChange={(e) => handleCustomerChange('phone', e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label>Company</label>
                      <input
                        type="text"
                        value={customerFormData.company}
                        onChange={(e) => handleCustomerChange('company', e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label>Password {isNewCustomer ? '(Required)' : '(Leave blank to keep current)'}</label>
                      <input
                        type="password"
                        value={customerFormData.password}
                        onChange={(e) => handleCustomerChange('password', e.target.value)}
                        required={isNewCustomer}
                        placeholder={isNewCustomer ? "Enter password" : "Enter new password to change"}
                      />
                    </div>
                  </div>
                </section>

                <section className="form-section">
                  <h3>Address</h3>
                  <div className="form-grid">
                    <div className="form-group full-width">
                      <label>Street Address</label>
                      <input
                        type="text"
                        value={customerFormData.address.street}
                        onChange={(e) => handleAddressChange('street', e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label>City</label>
                      <input
                        type="text"
                        value={customerFormData.address.city}
                        onChange={(e) => handleAddressChange('city', e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label>State</label>
                      <input
                        type="text"
                        value={customerFormData.address.state}
                        onChange={(e) => handleAddressChange('state', e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label>Zip Code</label>
                      <input
                        type="text"
                        value={customerFormData.address.zipCode}
                        onChange={(e) => handleAddressChange('zipCode', e.target.value)}
                      />
                    </div>
                  </div>
                </section>
              </form>
            </div>
          ) : (
            <div className="empty-selection">
              <Users size={48} />
              <h2>Select a customer to edit</h2>
              <p>Or create a new customer account</p>
              <button className="primary-btn" onClick={handleAddCustomer}>
                Create New Customer
              </button>
            </div>
          )
        ) : activeTab === 'settings' ? (
          <div className="settings-container">
            <div className="settings-section">
              <h2>Change Password</h2>
              <p className="section-description">Update your admin account password</p>

              {passwordStatus && (
                <div className={`status-message ${passwordStatus.type}`}>
                  {passwordStatus.message}
                </div>
              )}

              <form onSubmit={handlePasswordChange} className="password-form">
                <div className="form-group">
                  <label>Current Password</label>
                  <input
                    type="password"
                    value={passwordData.currentPassword}
                    onChange={(e) => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                    required
                    placeholder="Enter current password"
                  />
                </div>

                <div className="form-group">
                  <label>New Password</label>
                  <input
                    type="password"
                    value={passwordData.newPassword}
                    onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                    required
                    placeholder="Enter new password (min 6 characters)"
                  />
                </div>

                <div className="form-group">
                  <label>Confirm New Password</label>
                  <input
                    type="password"
                    value={passwordData.confirmPassword}
                    onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                    required
                    placeholder="Confirm new password"
                  />
                </div>

                <button type="submit" className="save-btn">
                  <Save size={18} /> Change Password
                </button>
              </form>
            </div>
          </div>
        ) : selectedProduct ? (
          <div className="edit-form">
            {/* Basic Info */}
            <section className="form-section">
              <h3>Basic Information</h3>
              <div className="form-grid">
                <div className="form-group">
                  <label>Product Name</label>
                  <input
                    type="text"
                    value={selectedProduct.name}
                    onChange={(e) => handleChange('name', e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Price</label>
                  <input
                    type="text"
                    value={selectedProduct.price}
                    onChange={(e) => handleChange('price', e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Category</label>
                  <select
                    value={selectedProduct.category}
                    onChange={(e) => handleChange('category', e.target.value)}
                  >
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Collection</label>
                  <select
                    value={selectedProduct.collection}
                    onChange={(e) => handleChange('collection', e.target.value)}
                  >
                    {collections.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
            </section>

            {/* Status & Media */}
            <section className="form-section">
              <h3>Status & Media</h3>
              <div className="form-grid">
                <div className="form-group">
                  <label>Availability</label>
                  <select
                    value={selectedProduct.availability || 'In Stock'}
                    onChange={(e) => handleChange('availability', e.target.value)}
                    className={`status-select ${selectedProduct.availability?.toLowerCase().replace(' ', '-')}`}
                  >
                    <option value="In Stock">In Stock</option>
                    <option value="Out of Stock">Out of Stock</option>
                    <option value="Low Stock">Low Stock</option>
                  </select>
                </div>
                <div className="form-group checkbox-wrapper">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={selectedProduct.isNewArrival || false}
                      onChange={(e) => handleChange('isNewArrival', e.target.checked)}
                    />
                    <span>Mark as New Arrival</span>
                  </label>
                </div>
                <div className="form-group checkbox-wrapper">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={selectedProduct.showInSlider || false}
                      onChange={(e) => handleChange('showInSlider', e.target.checked)}
                    />
                    <span>Show in Home Slider</span>
                  </label>
                </div>
                <div className="form-group full-width">
                  <label>Product Image</label>
                  <div className="image-input-wrapper">
                    <div className="image-upload-controls">
                      <input
                        type="text"
                        value={selectedProduct.image}
                        onChange={(e) => handleChange('image', e.target.value)}
                        placeholder="Image URL or path"
                        className="image-url-input"
                      />
                      <div className="file-upload-btn-wrapper">
                        <button className="secondary-btn upload-btn">
                          <ImageIcon size={16} /> Upload Image
                        </button>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleImageUpload}
                          className="file-input-hidden"
                        />
                      </div>
                    </div>
                    <div className="image-preview">
                      <img src={selectedProduct.image} alt="Preview" onError={(e) => e.target.src = '/images/products/placeholder.jpg'} />
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Details */}
            <section className="form-section">
              <h3>Details & Description</h3>
              <div className="form-group full-width">
                <label>Description</label>
                <textarea
                  rows="4"
                  value={selectedProduct.description || ''}
                  onChange={(e) => handleChange('description', e.target.value)}
                  placeholder="Enter product description..."
                />
              </div>
              <div className="form-grid">
                <div className="form-group">
                  <label>Primary Color</label>
                  <input
                    type="text"
                    value={selectedProduct.primaryColor || ''}
                    onChange={(e) => handleChange('primaryColor', e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Accent Color</label>
                  <input
                    type="text"
                    value={selectedProduct.accentColor || ''}
                    onChange={(e) => handleChange('accentColor', e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Style</label>
                  <input
                    type="text"
                    value={selectedProduct.style || ''}
                    onChange={(e) => handleChange('style', e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Variations</label>
                  <select
                    value={selectedProduct.variations || 'Low'}
                    onChange={(e) => handleChange('variations', e.target.value)}
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                  </select>
                </div>
              </div>
            </section>

            {/* Specifications */}
            <section className="form-section">
              <h3>Specifications</h3>

              <div className="specs-group">
                <label>Thickness</label>
                <div className="checkbox-grid">
                  {thicknessOptions.map(opt => (
                    <label key={opt} className="checkbox-pill">
                      <input
                        type="checkbox"
                        checked={(selectedProduct.thickness || []).includes(opt)}
                        onChange={(e) => handleArrayChange('thickness', opt, e.target.checked)}
                      />
                      <span>{opt}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="specs-group">
                <label>Sizes</label>
                <div className="checkbox-grid">
                  {sizeOptions.map(opt => (
                    <label key={opt} className="checkbox-pill">
                      <input
                        type="checkbox"
                        checked={(selectedProduct.sizes || []).includes(opt)}
                        onChange={(e) => handleArrayChange('sizes', opt, e.target.checked)}
                      />
                      <span>{opt}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="specs-group">
                <label>Finishes</label>
                <div className="checkbox-grid">
                  {finishOptions.map(opt => (
                    <label key={opt} className="checkbox-pill">
                      <input
                        type="checkbox"
                        checked={(selectedProduct.finishes || []).includes(opt)}
                        onChange={(e) => handleArrayChange('finishes', opt, e.target.checked)}
                      />
                      <span>{opt}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="specs-group">
                <label>Applications</label>
                <div className="checkbox-grid">
                  {applicationOptions.map(opt => (
                    <label key={opt} className="checkbox-pill">
                      <input
                        type="checkbox"
                        checked={(selectedProduct.applications || []).includes(opt)}
                        onChange={(e) => handleArrayChange('applications', opt, e.target.checked)}
                      />
                      <span>{opt}</span>
                    </label>
                  ))}
                </div>
              </div>
            </section>

            <div className="form-actions-bottom">
              <button
                className={`save-btn ${isSaving ? 'saving' : ''}`}
                onClick={() => saveData()}
                disabled={isSaving}
              >
                <Save size={18} /> {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>

          </div>
        ) : (
          <div className="empty-selection">
            <ImageIcon size={48} />
            <h2>Select a product to edit</h2>
            <p>Or create a new product to get started</p>
            <button className="primary-btn" onClick={handleAddProduct}>
              Create New Product
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminPage;
