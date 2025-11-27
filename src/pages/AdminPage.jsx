import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Save, Search, Image as ImageIcon, ArrowLeft, LogOut, Settings, Package, Users, User } from 'lucide-react';
import { API_ENDPOINTS, API_URL } from '../config/api';
import './AdminPage.css';

const AdminPage = () => {
  const navigate = useNavigate();
  // Initialize with empty array
  const [products, setProducts] = useState([]);
  const [selectedProductId, setSelectedProductId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('All');
  const [filterCollection, setFilterCollection] = useState('All');
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [loading, setLoading] = useState(true);
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
          if (data && data.length > 0) {
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

  const filteredCustomers = (Array.isArray(customers) ? customers : []).filter(c =>
    (c.firstName?.toLowerCase() || '').includes(customerSearchTerm.toLowerCase()) ||
    (c.lastName?.toLowerCase() || '').includes(customerSearchTerm.toLowerCase()) ||
    (c.email?.toLowerCase() || '').includes(customerSearchTerm.toLowerCase()) ||
    (c.company && c.company.toLowerCase().includes(customerSearchTerm.toLowerCase()))
  );

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

    // Show immediate preview
    const objectUrl = URL.createObjectURL(file);
    handleChange('image', objectUrl);

    const formData = new FormData();
    formData.append('image', file);

    try {
      const response = await fetch(API_ENDPOINTS.UPLOAD, {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();

      if (data.success) {
        // Update with actual server path
        handleChange('image', data.filePath);
        // Clean up object URL to avoid memory leaks
        URL.revokeObjectURL(objectUrl);
      } else {
        alert('Failed to upload image');
        // Revert to placeholder or previous image if needed
        // For now, we'll just leave the preview or user can try again
      }
    } catch (error) {
      console.error('Error uploading image:', error);
      alert('Error uploading image');
    }
  };
  const sizeOptions = ['126 * 63', '135 * 77', '136 * 78', '138 * 79', '139 * 80', '143 * 80'];
  const finishOptions = ['Polished', 'Honed', 'Leathered', 'Concrete'];
  const applicationOptions = ['Countertops', 'Backsplash', 'Wall Cladding', 'Flooring', 'Shower Walls'];



  // Customer Management Functions
  const handleSelectCustomer = (customer) => {
    setSelectedCustomerId(customer._id);
    setCustomerFormData({
      firstName: customer.firstName || '',
      lastName: customer.lastName || '',
      email: customer.email || '',
      password: '', // Don't show password
      phone: customer.phone || '',
      company: customer.company || '',
      address: {
        street: customer.address?.street || '',
        city: customer.address?.city || '',
        state: customer.address?.state || '',
        zipCode: customer.address?.zipCode || ''
      },
      priceLevel: customer.priceLevel || 1
    });
    setIsNewCustomer(false);
    setCustomerSaveStatus(null);
    window.scrollTo(0, 0);
  };

  const handleAddCustomer = () => {
    setSelectedCustomerId('new');
    setCustomerFormData({
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
      },
      priceLevel: 1
    });
    setIsNewCustomer(true);
    setCustomerSaveStatus(null);
  };

  const handleCustomerChange = (field, value) => {
    setCustomerFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleAddressChange = (field, value) => {
    setCustomerFormData(prev => ({
      ...prev,
      address: {
        ...prev.address,
        [field]: value
      }
    }));
  };

  const saveCustomer = async (e) => {
    if (e) e.preventDefault();

    // Client-side validation
    if (!customerFormData.firstName?.trim()) {
      setCustomerSaveStatus({ type: 'error', message: 'First Name is required' });
      return;
    }
    if (!customerFormData.lastName?.trim()) {
      setCustomerSaveStatus({ type: 'error', message: 'Last Name is required' });
      return;
    }
    if (!customerFormData.email?.trim()) {
      setCustomerSaveStatus({ type: 'error', message: 'Email is required' });
      return;
    }
    if (isNewCustomer && !customerFormData.password?.trim()) {
      setCustomerSaveStatus({ type: 'error', message: 'Password is required for new customers' });
      return;
    }

    setIsSaving(true);
    setCustomerSaveStatus(null);

    try {
      const url = isNewCustomer
        ? `${API_URL}/api/admin/customers`
        : `${API_URL}/api/admin/customers/${selectedCustomerId}`;

      const method = isNewCustomer ? 'POST' : 'PUT';

      // Remove password if empty for updates
      const dataToSend = { ...customerFormData };
      if (!isNewCustomer && !dataToSend.password) {
        delete dataToSend.password;
      }

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(dataToSend)
      });

      const data = await response.json();

      if (response.ok) {
        setCustomerSaveStatus({ type: 'success', message: `Customer ${isNewCustomer ? 'created' : 'updated'} successfully!` });

        // Refresh customers list
        const customersResponse = await fetch(`${API_URL}/api/admin/customers`, {
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include'
        });
        if (customersResponse.ok) {
          const customersData = await customersResponse.json();
          setCustomers(customersData);
        }

        if (isNewCustomer) {
          setIsNewCustomer(false);
          setSelectedCustomerId(data._id || data.customer?._id); // Handle different response structures
        }
      } else {
        setCustomerSaveStatus({ type: 'error', message: data.message || data.error || 'Failed to save customer' });
      }
    } catch (error) {
      console.error('Error saving customer:', error);
      setCustomerSaveStatus({ type: 'error', message: `Failed to save customer: ${error.message}` });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteCustomer = async (id) => {
    if (window.confirm('Are you sure you want to delete this customer? This cannot be undone.')) {
      try {
        const response = await fetch(`${API_URL}/api/admin/customers/${id}`, {
          method: 'DELETE',
          credentials: 'include'
        });

        if (response.ok) {
          setCustomers(prev => prev.filter(c => c._id !== id));
          if (selectedCustomerId === id) {
            setSelectedCustomerId(null);
          }
          setCustomerSaveStatus({ type: 'success', message: 'Customer deleted successfully' });
        } else {
          const data = await response.json();
          throw new Error(data.message || 'Failed to delete customer');
        }
      } catch (error) {
        console.error('Error deleting customer:', error);
        setCustomerSaveStatus({ type: 'error', message: error.message });
      }
    }
  };

  const handleToggleCustomerStatus = async (id, currentStatus) => {
    const newStatus = !currentStatus;
    const action = newStatus ? 'activate' : 'deactivate';

    if (window.confirm(`Are you sure you want to ${action} this customer?`)) {
      try {
        const response = await fetch(`${API_URL}/api/admin/customers/${id}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ isActive: newStatus })
        });

        if (response.ok) {
          // Refresh customers list to ensure sync
          const customersResponse = await fetch(`${API_URL}/api/admin/customers`, {
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include'
          });
          if (customersResponse.ok) {
            const customersData = await customersResponse.json();
            setCustomers(customersData);
          }

          setCustomerSaveStatus({ type: 'success', message: `Customer ${action}d successfully` });
        } else {
          const data = await response.json();
          throw new Error(data.message || `Failed to ${action} customer`);
        }
      } catch (error) {
        console.error(`Error ${action}ing customer:`, error);
        setCustomerSaveStatus({ type: 'error', message: `Failed to ${action} customer: ${error.message}` });
      }
    }
  };

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
      {(activeTab === 'products' || activeTab === 'customers') && (
        <div className="admin-sidebar">
          <div className="sidebar-header">
            <h2>{activeTab === 'products' ? 'Products' : 'Customers'}</h2>
            <button className="add-btn" onClick={activeTab === 'products' ? handleAddProduct : handleAddCustomer}>
              <Plus size={18} /> New
            </button>
          </div>

          <div className="search-box">
            <Search size={16} className="search-icon" />
            <input
              type="text"
              placeholder={`Search ${activeTab}...`}
              value={activeTab === 'products' ? searchTerm : customerSearchTerm}
              onChange={(e) => activeTab === 'products' ? setSearchTerm(e.target.value) : setCustomerSearchTerm(e.target.value)}
            />
          </div>

          {activeTab === 'products' && (
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
          )}

          <div className="product-list">
            {activeTab === 'products' ? (
              filteredProducts.map(product => (
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
              ))
            ) : (
              filteredCustomers.length === 0 ? (
                <div className="empty-list-message">
                  No customers found
                </div>
              ) : (
                filteredCustomers.map(customer => (
                  <div
                    key={customer._id}
                    className={`product-list-item ${selectedCustomerId === customer._id ? 'active' : ''}`}
                    onClick={() => handleSelectCustomer(customer)}
                  >
                    <div className="list-thumb-placeholder">
                      <User size={20} />
                    </div>
                    <div className="list-info">
                      <span className="list-name">
                        {customer.firstName} {customer.lastName}
                        {customer.isActive === false && <span style={{ color: '#ef4444', fontSize: '0.75rem', marginLeft: '0.5rem' }}>(Deactivated)</span>}
                      </span>
                      <span className="list-meta">{customer.company || customer.email}</span>
                    </div>
                  </div>
                ))
              )
            )}
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className={`admin-main ${activeTab === 'settings' ? 'full-width' : ''}`}>
        {activeTab === 'products' && (
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
        )}

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
                  {!isNewCustomer && (
                    <>
                      <button
                        className="delete-btn"
                        onClick={() => handleDeleteCustomer(selectedCustomerId)}
                      >
                        <Trash2 size={18} /> Delete
                      </button>
                      <button
                        className="secondary-btn"
                        onClick={() => handleToggleCustomerStatus(selectedCustomerId, customers.find(c => c._id === selectedCustomerId)?.isActive ?? true)}
                        style={{ borderColor: customers.find(c => c._id === selectedCustomerId)?.isActive !== false ? '#ef4444' : '#10b981', color: customers.find(c => c._id === selectedCustomerId)?.isActive !== false ? '#ef4444' : '#10b981' }}
                      >
                        {customers.find(c => c._id === selectedCustomerId)?.isActive !== false ? 'Deactivate' : 'Activate'}
                      </button>
                    </>
                  )}
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
                {!isNewCustomer && customers.find(c => c._id === selectedCustomerId) && (
                  <section className="form-section metadata-section">
                    <h3>Account Details</h3>
                    <div className="form-grid">
                      <div className="form-group">
                        <label>Customer ID</label>
                        <input type="text" value={selectedCustomerId} disabled className="readonly-input" />
                      </div>
                      <div className="form-group">
                        <label>Joined Date</label>
                        <input
                          type="text"
                          value={customers.find(c => c._id === selectedCustomerId).createdAt ? new Date(customers.find(c => c._id === selectedCustomerId).createdAt).toLocaleDateString() : 'N/A'}
                          disabled
                          className="readonly-input"
                        />
                      </div>
                      <div className="form-group">
                        <label>Verified</label>
                        <input
                          type="text"
                          value={customers.find(c => c._id === selectedCustomerId).isVerified ? 'Yes' : 'No'}
                          disabled
                          className="readonly-input"
                        />
                      </div>
                      <div className="form-group">
                        <label>Status</label>
                        <input
                          type="text"
                          value={customers.find(c => c._id === selectedCustomerId).isActive !== false ? 'Active' : 'Deactivated'}
                          disabled
                          className="readonly-input"
                          style={{ color: customers.find(c => c._id === selectedCustomerId).isActive !== false ? '#10b981' : '#ef4444' }}
                        />
                      </div>
                      <div className="form-group">
                        <label>Login Attempts</label>
                        <input
                          type="text"
                          value={customers.find(c => c._id === selectedCustomerId).loginAttempts || 0}
                          disabled
                          className="readonly-input"
                        />
                      </div>
                      <div className="form-group">
                        <label>Price Level</label>
                        <select
                          value={customerFormData.priceLevel || 1}
                          onChange={(e) => setCustomerFormData(prev => ({ ...prev, priceLevel: parseInt(e.target.value) }))}
                        >
                          <option value={1}>Level 1 (40% Margin)</option>
                          <option value={2}>Level 2 (30% Margin)</option>
                          <option value={3}>Level 3 (20% Margin)</option>
                          <option value={4}>Level 4 (10% Margin)</option>
                        </select>
                      </div>
                    </div>
                  </section>
                )}
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

            {/* Pricing Section */}
            <section className="form-section">
              <h3>Pricing</h3>
              <div className="form-grid">
                <div className="form-group">
                  <label>Landing Cost ($)</label>
                  <input
                    type="number"
                    value={selectedProduct.landingCost || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      const cost = parseFloat(val);

                      // Update the product in the products array
                      setProducts(prev => prev.map(p => {
                        if (p.id !== selectedProductId) return p;

                        // Store as number if valid, otherwise keep the string for typing
                        const updates = {
                          landingCost: val === '' ? undefined : (isNaN(cost) ? val : cost)
                        };

                        if (!isNaN(cost) && val !== '') {
                          // Round to nearest $0.50
                          const roundToHalf = (num) => Math.round(num * 2) / 2;

                          // Gross Margin Formula: Price = Cost / (1 - Margin%)
                          updates.priceLevels = {
                            level1: roundToHalf(cost / 0.6), // 40% margin
                            level2: roundToHalf(cost / 0.7), // 30% margin
                            level3: roundToHalf(cost / 0.8), // 20% margin
                            level4: roundToHalf(cost / 0.9)  // 10% margin
                          };
                        }

                        return { ...p, ...updates };
                      }));
                    }}
                    placeholder="Enter landing cost"
                  />
                </div>
              </div>

              {(selectedProduct.landingCost || selectedProduct.priceLevels) && (
                <div className="price-levels-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginTop: '1rem' }}>
                  <div className="price-card" style={{ background: 'var(--bg-card)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', color: '#888', marginBottom: '0.5rem' }}>Level 1 (40%)</label>
                    <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#10b981' }}>${selectedProduct.priceLevels?.level1 || 0}</div>
                  </div>
                  <div className="price-card" style={{ background: 'var(--bg-card)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', color: '#888', marginBottom: '0.5rem' }}>Level 2 (30%)</label>
                    <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#10b981' }}>${selectedProduct.priceLevels?.level2 || 0}</div>
                  </div>
                  <div className="price-card" style={{ background: 'var(--bg-card)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', color: '#888', marginBottom: '0.5rem' }}>Level 3 (20%)</label>
                    <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#10b981' }}>${selectedProduct.priceLevels?.level3 || 0}</div>
                  </div>
                  <div className="price-card" style={{ background: 'var(--bg-card)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', color: '#888', marginBottom: '0.5rem' }}>Level 4 (10%)</label>
                    <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#10b981' }}>${selectedProduct.priceLevels?.level4 || 0}</div>
                  </div>
                </div>
              )}
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
