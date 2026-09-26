import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Save, Search, Image as ImageIcon, ArrowLeft, LogOut, Settings, Package, User, Menu, X, Pencil } from 'lucide-react';
import { API_ENDPOINTS, API_URL } from '../config/api';
import { useProducts } from '../context/ProductContext';
import { useAuth } from '../context/AuthContext';
import './AdminPage.css';
import { authFetch } from '../api/authFetch';

const AdminPage = () => {
  const navigate = useNavigate();
  const { refreshProducts } = useProducts();
  const { logout } = useAuth();
  // Initialize with empty array
  const [products, setProducts] = useState([]);
  const [selectedProductId, setSelectedProductId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('All');
  const [filterCollection, setFilterCollection] = useState('All');
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [, setUsersLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('products');
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [passwordStatus, setPasswordStatus] = useState(null);

  // User Management State
  const [users, setUsers] = useState([]);
  const [userSearchTerm, setUserSearchTerm] = useState('');
  const [userFormData, setUserFormData] = useState({
    username: '',
    displayName: '',
    email: '',
    password: '',
    role: 'sales_rep',
    location: ''
  });
  const [isNewUser, setIsNewUser] = useState(false);
  const [editingUserId, setEditingUserId] = useState(null);
  const [userSaveStatus, setUserSaveStatus] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');

  // Mobile View State
  const [showMobileDetail, setShowMobileDetail] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const fetchProducts = useCallback(async () => {
    try {
      setLoading(true);
      const response = await authFetch(`${API_URL}/api/admin/products/list`);
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
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      setUsersLoading(true);
      const response = await authFetch(`${API_URL}/api/admin/users`);
      if (response.ok) {
        const data = await response.json();
        setUsers(data);
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.error('Failed to fetch users:', errorData.message || response.statusText);
      }
    } catch (error) {
      console.error('Error fetching users:', error);
    } finally {
      setUsersLoading(false);
    }
  }, []);

  // Fetch all basic data on mount to ensure sidebars are populated
  useEffect(() => {
    fetchProducts();
    fetchUsers();
  }, [fetchProducts, fetchUsers, refreshProducts]);

  // Read initial tab parameter from URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    if (tabParam && ['products', 'users', 'settings'].includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, []);

  // Handle tab specific refreshes if needed, but basic data is now prefetched
  useEffect(() => {
    if (activeTab === 'users' && users.length === 0) {
      fetchUsers();
    }
  }, [activeTab, fetchUsers, users.length]);

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Show immediate preview
    const objectUrl = URL.createObjectURL(file);
    handleChange('image', objectUrl);

    const formData = new FormData();
    formData.append('image', file);

    setIsUploading(true); // Start upload status

    try {
      const response = await authFetch(API_ENDPOINTS.UPLOAD, {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();

      if (data.success) {
        // Update both main image and generated installed mockups
        handleChange('image', data.filePath);
        if (data.installedImages && data.installedImages.length > 0) {
          handleChange('installedImages', data.installedImages);
        }
        // Clean up object URL to avoid memory leaks
        URL.revokeObjectURL(objectUrl);
      } else {
        console.error('Upload failed:', data);
        alert(`Failed to upload image: ${data.error || 'Unknown error'}\nDetails: ${data.details || 'No details provided'}`);
        // Revert to placeholder or keep preview? Keeping preview might be misleading if save fails.
        // For now, alert is enough.
      }
    } catch (error) {
      console.error('Error uploading image:', error);
      alert(`Error uploading image: ${error.message}`);
    } finally {
      setIsUploading(false); // End upload status
    }
  };

  const handleInstalledImageUpload = async (e, index) => {
    const file = e.target.files[0];
    if (!file) return;

    // Create a copy of current installed images or initialize empty array
    const currentImages = [...(selectedProduct.installedImages || [])];

    // Show immediate preview
    const objectUrl = URL.createObjectURL(file);
    currentImages[index] = objectUrl;
    handleChange('installedImages', currentImages);

    const formData = new FormData();
    formData.append('image', file);

    setIsUploading(true);

    try {
      const response = await authFetch(API_ENDPOINTS.UPLOAD, {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();

      if (data.success) {
        // Update with actual server path
        const updatedImages = [...(selectedProduct.installedImages || [])];
        updatedImages[index] = data.filePath;
        handleChange('installedImages', updatedImages);
        // Clean up object URL
        URL.revokeObjectURL(objectUrl);
      } else {
        alert('Failed to upload installed image');
      }
    } catch (error) {
      console.error('Error uploading installed image:', error);
      alert('Error uploading installed image');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteImage = async (imageUrl, type = 'main', index = null) => {
    if (!imageUrl || !imageUrl.includes('cloudinary.com')) {
      // If it's not a Cloudinary URL, just clear it locally
      if (type === 'main') {
        handleChange('image', '');
      } else {
        removeInstalledImage(index);
      }
      return;
    }

    const confirmed = window.confirm('Delete this image from Cloudinary? This cannot be undone.');
    if (!confirmed) return;

    try {
      const response = await authFetch(`${API_URL}/api/upload/delete`, {
        method: 'POST',
        body: JSON.stringify({ imageUrl })
      });

      const data = await response.json();

      if (data.success) {
        // Clear the image from local state
        if (type === 'main') {
          handleChange('image', '');
        } else {
          removeInstalledImage(index);
        }
      } else {
        alert(`Failed to delete image: ${data.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error deleting image:', error);
      alert(`Error deleting image: ${error.message}`);
    }
  };

  // Bundle Management Handlers
  const handleAddBundle = () => {
    if (!selectedProduct) return;
    const currentBundles = selectedProduct.bundles || [];
    const newBundle = {
      bundleNumber: '',
      location: 'SEATTLE, WA',
      images: []
    };
    handleChange('bundles', [...currentBundles, newBundle]);
  };

  const handleRemoveBundle = (index) => {
    if (!selectedProduct) return;
    const currentBundles = [...(selectedProduct.bundles || [])];
    currentBundles.splice(index, 1);
    handleChange('bundles', currentBundles);
  };

  const handleBundleFieldChange = (index, field, value) => {
    if (!selectedProduct) return;
    const currentBundles = [...(selectedProduct.bundles || [])];
    currentBundles[index] = { ...currentBundles[index], [field]: value };
    handleChange('bundles', currentBundles);
  };

  const handleBundleImageUpload = async (e, bundleIndex) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('image', file);

    try {
      const response = await authFetch(API_ENDPOINTS.UPLOAD, {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();

      if (data.success) {
        const currentBundles = [...(selectedProduct.bundles || [])];
        const bundle = { ...currentBundles[bundleIndex] };
        bundle.images = [...(bundle.images || []), data.filePath];
        currentBundles[bundleIndex] = bundle;
        handleChange('bundles', currentBundles);
      } else {
        alert('Failed to upload bundle image');
      }
    } catch (error) {
      console.error('Error uploading bundle image:', error);
      alert('Error uploading bundle image');
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemoveBundleImage = (bundleIndex, imageIndex) => {
    if (!selectedProduct) return;

    if (!window.confirm('Delete this image?')) return;

    const currentBundles = [...(selectedProduct.bundles || [])];
    const bundle = { ...currentBundles[bundleIndex] };
    const newImages = [...bundle.images];
    newImages.splice(imageIndex, 1);
    bundle.images = newImages;
    currentBundles[bundleIndex] = bundle;
    handleChange('bundles', currentBundles);
  };

  // Initialize selected product when products change or on first load
  const selectedProduct = products.find(p => p.id === selectedProductId);

  // Filter products for sidebar
  const filteredProducts = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = filterCategory === 'All' || p.category === filterCategory;
    const matchesCollection = filterCollection === 'All' || p.collection === filterCollection;
    return matchesSearch && matchesCategory && matchesCollection;
  }).sort((a, b) => a.name.localeCompare(b.name));

  const filteredUsers = (Array.isArray(users) ? users : []).filter(u =>
    (u.username?.toLowerCase() || '').includes(userSearchTerm.toLowerCase()) ||
    (u.email?.toLowerCase() || '').includes(userSearchTerm.toLowerCase()) ||
    (u.role?.toLowerCase() || '').includes(userSearchTerm.toLowerCase())
  );

  const handleEditUser = (user) => {
    setEditingUserId(user._id);
    setUserFormData({
      username: user.username,
      displayName: user.displayName || '',
      email: user.email || '',
      password: '', // Keep blank unless changing
      role: user.role,
      location: user.location || ''
    });
    setIsNewUser(true);
  };

  const handleUserSubmit = async (e) => {
    e.preventDefault();
    setUserSaveStatus('saving');

    const url = editingUserId
      ? `${API_URL}/api/admin/users/${editingUserId}`
      : `${API_URL}/api/admin/users`;

    const method = editingUserId ? 'PUT' : 'POST';

    try {
      const response = await authFetch(url, {
        method,
        body: JSON.stringify(userFormData)
      });

      if (response.ok) {
        setUserSaveStatus('success');
        setIsNewUser(false);
        setEditingUserId(null);
        setUserFormData({ username: '', email: '', password: '', role: 'sales_rep', location: '' });
        // Refresh users
        const usersRes = await authFetch(`${API_URL}/api/admin/users`);
        if (usersRes.ok) {
          const data = await usersRes.json();
          setUsers(data);
        }
      } else {
        const errorData = await response.json();
        setErrorMessage(errorData.message || `Failed to ${editingUserId ? 'update' : 'create'} user`);
        setUserSaveStatus('error');
      }
    } catch (error) {
      console.error(`Error ${editingUserId ? 'updating' : 'creating'} user:`, error);
      setErrorMessage(`Error ${editingUserId ? 'updating' : 'creating'} user`);
      setUserSaveStatus('error');
    }

    setTimeout(() => setUserSaveStatus(null), 3000);
  };

  const handleDeleteUser = async (userId) => {
    if (!window.confirm('Are you sure you want to delete this user?')) return;

    try {
      const response = await authFetch(`${API_URL}/api/admin/users/${userId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        setUsers(users.filter(u => u._id !== userId));
      }
    } catch (error) {
      console.error('Error deleting user:', error);
    }
  };

  const handleSelectProduct = async (id) => {
    setSelectedProductId(id);
    setSaveStatus(null);
    setShowMobileDetail(true); // Show detail view on mobile
    window.scrollTo(0, 0);

    // Lazy load: Fetch full product details
    try {
      const response = await authFetch(`${API_URL}/api/admin/products/${id}`);
      if (response.ok) {
        const fullProduct = await response.json();
        // Update products array with full details
        setProducts(prev => prev.map(p => p.id === id ? fullProduct : p));
      }
    } catch (error) {
      console.error('Error fetching product details:', error);
    }
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
      applications: ['Countertops', 'Backsplash', 'Wall Cladding'],
      bookMatch: 'N/A'
    };

    setProducts([newProduct, ...products]);
    setSelectedProductId(newId);
    setSaveStatus({ type: 'info', message: 'New product created. Fill in details and save.' });
    setShowMobileDetail(true); // Show detail view on mobile
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
      const response = await authFetch(API_ENDPOINTS.SAVE_PRODUCTS, {
        method: 'POST',
        body: JSON.stringify({ products: productsToSave }),
      });

      const data = await response.json();

      if (data.success) {
        setSaveStatus({ type: 'success', message: 'Changes saved successfully!' });
        refreshProducts(); // Update global cache
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
      await logout();
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
      const response = await authFetch(`${API_URL}/api/auth/change-password`, {
        method: 'POST',
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
  const categories = ['Quartz', 'Granite', 'Marble', 'Sinks', 'Quartzite', 'MODA PST'];
  const thicknessOptions = ['1.5CM', '2CM', '3CM'];
  const bundleLocations = [
    'ATLANTA, GA',
    'CHARLESTON, SC',
    'CHARLOTTE, NC',
    'DALLAS, TX',
    'FORT WALTON BEACH, FL',
    'GREENSBORO, NC',
    'HOUSTON, TX',
    'RICHMOND, VA',
    'SEATTLE, WA',
    'SPOKANE, WA',
    'SALT LAKE CITY, UT',
    'RALEIGH, NC'
  ];



  const removeInstalledImage = (index) => {
    const currentImages = [...(selectedProduct.installedImages || [])];
    currentImages.splice(index, 1);
    handleChange('installedImages', currentImages);
  };
  const sizeOptions = ['126 * 63', '135 * 77', '136 * 78', '138 * 79', '139 * 80', '143 * 80'];
  const finishOptions = ['Polished', 'Honed', 'Leathered', 'Concrete'];
  const applicationOptions = ['Countertops', 'Backsplash', 'Wall Cladding', 'Flooring', 'Shower Walls'];



  const handleTabChange = (tab) => {
    setActiveTab(tab);
    const newUrl = new URL(window.location);
    newUrl.searchParams.set('tab', tab);
    window.history.replaceState({}, '', newUrl);
    setIsMobileMenuOpen(false);
    setShowMobileDetail(false); // Reset to list view
    window.scrollTo(0, 0);
  };

  return (
    <div className="admin-container">
      <div className="admin-header">
        <div className="admin-header-content">
          <div className="admin-header-top">
            <div className="admin-brand">
              <h1>Admin Panel</h1>
              <span className="admin-breadcrumb-edge">/</span>
              <span className="admin-current-path">{activeTab.toUpperCase()}</span>
            </div>
            <button
              className="mobile-menu-toggle"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            >
              {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>

          <div className={`admin-header-center ${isMobileMenuOpen ? 'open' : ''}`}>
            <div className="header-tabs">
              <button
                className={`tab-btn ${activeTab === 'products' ? 'active' : ''}`}
                onClick={() => handleTabChange('products')}
              >
                <Package size={18} />
                <span>Products</span>
              </button>
              <button
                className={`tab-btn ${activeTab === 'users' ? 'active' : ''}`}
                onClick={() => handleTabChange('users')}
              >
                <User size={18} />
                <span>Users</span>
              </button>
              <button
                className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
                onClick={() => handleTabChange('settings')}
              >
                <Settings size={18} />
                <span>Settings</span>
              </button>

              <div className="nav-divider"></div>

              <button className="logout-btn nav-item-logout" onClick={handleLogout}>
                <LogOut size={16} />
                <span>Logout</span>
              </button>
            </div>
          </div>

          <div className="admin-header-right-empty"></div>
        </div>
      </div>

      {/* Sidebar */}
      {activeTab === 'products' && (
        <div className={`admin-sidebar ${showMobileDetail ? 'mobile-hidden' : ''}`}>
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
            {loading ? (
              <div className="loading-list-message">
                <div className="loader-spinner-small"></div>
                <span>Loading products...</span>
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="empty-list-message">
                No products found
              </div>
            ) : (
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
            )}
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className={`admin-main ${activeTab === 'settings' || activeTab === 'users' ? 'full-width' : ''} ${!showMobileDetail && activeTab === 'products' ? 'mobile-hidden' : ''}`}>
        {activeTab === 'products' && (
          <div className="main-header">
            <div className="header-title-group">
              <button className="mobile-back-btn" onClick={() => setShowMobileDetail(false)}>
                <ArrowLeft size={20} />
              </button>
              <h1>Product Editor</h1>
            </div>
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

        {activeTab === 'users' ? (
          <div className="admin-main full-width">
            <div className="settings-container">
              <div className="settings-section">
                <div className="users-tab-header">
                  <div className="users-tab-title">
                    <h2>User Management</h2>
                    <p className="section-description">Manage internal users and assign roles.</p>
                  </div>
                  <button
                    className="primary-btn add-user-btn"
                    onClick={() => {
                      setIsNewUser(true);
                      setEditingUserId(null);
                      setUserFormData({ username: '', email: '', password: '', role: 'sales_rep', location: '' });
                    }}
                  >
                    <Plus size={18} /> <span>Add User</span>
                  </button>
                </div>

                {isNewUser && (
                  <div className="form-section" style={{ marginBottom: '2rem' }}>
                    <h3>{editingUserId ? 'Edit User' : 'Add New User'}</h3>
                    <form onSubmit={handleUserSubmit}>
                      <div className="form-grid">
                        <div className="form-group">
                          <label>Username</label>
                          <input
                            type="text"
                            value={userFormData.username}
                            onChange={(e) => setUserFormData({ ...userFormData, username: e.target.value })}
                            required
                          />
                        </div>
                        <div className="form-group">
                          <label>Display Name</label>
                          <input
                            type="text"
                            value={userFormData.displayName}
                            onChange={(e) => setUserFormData({ ...userFormData, displayName: e.target.value })}
                            placeholder="Shown in the app — blank uses the username"
                          />
                        </div>
                        <div className="form-group">
                          <label>Email</label>
                          <input
                            type="email"
                            value={userFormData.email}
                            onChange={(e) => setUserFormData({ ...userFormData, email: e.target.value })}
                          />
                        </div>
                        <div className="form-group">
                          <label>Password {editingUserId && '(Leave blank to keep current)'}</label>
                          <input
                            type="password"
                            value={userFormData.password}
                            onChange={(e) => setUserFormData({ ...userFormData, password: e.target.value })}
                            required={!editingUserId}
                            placeholder={editingUserId ? "New password" : "Enter password"}
                          />
                        </div>
                        <div className="form-group">
                          <label>Role</label>
                          <select
                            className="role-select"
                            value={userFormData.role}
                            onChange={(e) => setUserFormData({ ...userFormData, role: e.target.value })}
                          >
                            <option value="sales_rep">Sales Rep</option>
                            <option value="manager">Manager</option>
                            <option value="director">Director</option>
                            <option value="admin">Admin</option>
                          </select>
                        </div>
                        <div className="form-group">
                          <label>Location</label>
                          <input
                            type="text"
                            value={userFormData.location}
                            onChange={(e) => setUserFormData({ ...userFormData, location: e.target.value })}
                            placeholder="e.g. New York, Austin, etc."
                          />
                        </div>
                      </div>
                      <div className="form-actions-bottom">
                        <button
                          type="button"
                          className="secondary-btn"
                          onClick={() => {
                            setIsNewUser(false);
                            setEditingUserId(null);
                            setUserFormData({ username: '', email: '', password: '', role: 'sales_rep', location: '' });
                          }}
                          style={{ marginRight: '1rem' }}
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="save-btn"
                          disabled={userSaveStatus === 'saving'}
                        >
                          {userSaveStatus === 'saving' ? (editingUserId ? 'Updating...' : 'Creating...') : (editingUserId ? 'Update User' : 'Create User')}
                        </button>
                      </div>
                      {userSaveStatus === 'success' && (
                        <div className="status-message success">User {editingUserId ? 'updated' : 'created'} successfully!</div>
                      )}
                      {userSaveStatus === 'error' && (
                        <div className="status-message error">
                          {errorMessage}
                        </div>
                      )}
                    </form>
                  </div>
                )}

                <div className="users-list-section">
                  <div className="search-box">
                    <Search className="search-icon" size={18} />
                    <input
                      type="text"
                      placeholder="Search users..."
                      value={userSearchTerm}
                      onChange={(e) => setUserSearchTerm(e.target.value)}
                    />
                  </div>

                  <div className="table-responsive">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Username</th>
                          <th>Email</th>
                          <th>Location</th>
                          <th>Role</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredUsers.map(user => (
                          <tr key={user._id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                            <td style={{ padding: '1rem', color: 'var(--text-primary)' }}>{user.username}</td>
                            <td style={{ padding: '1rem', color: 'var(--text-primary)' }}>{user.email || '-'}</td>
                            <td style={{ padding: '1rem', color: 'var(--text-primary)' }}>{user.location || '-'}</td>
                            <td style={{ padding: '1rem' }}>
                              <span style={{
                                padding: '0.25rem 0.75rem',
                                borderRadius: '100px',
                                fontSize: '0.85rem',
                                background: user.role === 'admin' ? 'rgba(239, 68, 68, 0.1)' :
                                  user.role === 'director' ? 'rgba(168, 85, 247, 0.1)' :
                                    user.role === 'manager' ? 'rgba(59, 130, 246, 0.1)' :
                                      'rgba(16, 185, 129, 0.1)',
                                color: user.role === 'admin' ? '#ef4444' :
                                  user.role === 'director' ? '#a855f7' :
                                    user.role === 'manager' ? '#3b82f6' :
                                      '#10b981'
                              }}>
                                {user.role === 'sales_rep' ? 'Sales Rep' :
                                  user.role.charAt(0).toUpperCase() + user.role.slice(1)}
                              </span>
                            </td>
                            <td style={{ padding: '1rem', display: 'flex', gap: '0.5rem' }}>
                              <button
                                className="secondary-btn"
                                onClick={() => handleEditUser(user)}
                                style={{ padding: '0.5rem', borderColor: 'var(--accent-primary)', color: 'var(--accent-primary)' }}
                              >
                                <Pencil size={16} />
                              </button>
                              <button
                                className="secondary-btn delete-btn-small"
                                onClick={() => handleDeleteUser(user._id)}
                                style={{ padding: '0.5rem', borderColor: '#ef4444', color: '#ef4444' }}
                              >
                                <Trash2 size={16} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>
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
                    <div className="image-preview" style={{ position: 'relative' }}>
                      <img src={selectedProduct.image} alt="Preview" onError={(e) => e.target.src = '/images/products/placeholder.jpg'} />
                      {selectedProduct.image && (
                        <button
                          className="secondary-btn delete-btn-small"
                          type="button"
                          onClick={() => handleDeleteImage(selectedProduct.image, 'main')}
                          style={{
                            position: 'absolute',
                            top: '0.5rem',
                            right: '0.5rem',
                            borderColor: '#ef4444',
                            color: '#ef4444',
                            backgroundColor: 'rgba(255, 255, 255, 0.9)'
                          }}
                        >
                          <Trash2 size={14} /> Remove
                        </button>
                      )}
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
                <div className="form-group">
                  <label>Book Match</label>
                  <select
                    value={selectedProduct.bookMatch || 'N/A'}
                    onChange={(e) => handleChange('bookMatch', e.target.value)}
                  >
                    <option value="N/A">N/A</option>
                    <option value="Yes">Yes</option>
                    <option value="No">No</option>
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
                            level1: roundToHalf(cost / 0.9), // 10% margin
                            level2: roundToHalf(cost / 0.8), // 20% margin
                            level3: roundToHalf(cost / 0.7), // 30% margin
                            level4: roundToHalf(cost / 0.6)  // 40% margin
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
                    <label style={{ display: 'block', fontSize: '0.8rem', color: '#888', marginBottom: '0.5rem' }}>Level 1 (10%)</label>
                    <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#10b981' }}>${selectedProduct.priceLevels?.level1 || 0}</div>
                  </div>
                  <div className="price-card" style={{ background: 'var(--bg-card)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', color: '#888', marginBottom: '0.5rem' }}>Level 2 (20%)</label>
                    <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#10b981' }}>${selectedProduct.priceLevels?.level2 || 0}</div>
                  </div>
                  <div className="price-card" style={{ background: 'var(--bg-card)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', color: '#888', marginBottom: '0.5rem' }}>Level 3 (30%)</label>
                    <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#10b981' }}>${selectedProduct.priceLevels?.level3 || 0}</div>
                  </div>
                  <div className="price-card" style={{ background: 'var(--bg-card)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', color: '#888', marginBottom: '0.5rem' }}>Level 4 (40%)</label>
                    <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#10b981' }}>${selectedProduct.priceLevels?.level4 || 0}</div>
                  </div>
                </div>
              )}
            </section>

            {['Quartzite', 'Granite', 'Marble'].includes(selectedProduct.category) ? (
              /* Bundle Management Section */
              <div className="form-section">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h3>Bundle Management</h3>
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={handleAddBundle}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                  >
                    <Plus size={16} /> Add Bundle
                  </button>
                </div>

                {(selectedProduct.bundles || []).map((bundle, bundleIndex) => (
                  <div key={bundleIndex} className="bundle-card" style={{ background: 'rgba(255,255,255,0.05)', padding: '1rem', borderRadius: '8px', marginBottom: '1rem', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', mb: '1rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <h4 style={{ margin: 0, color: '#aaa' }}>Bundle {bundleIndex + 1}</h4>
                        <button
                          type="button"
                          onClick={() => handleRemoveBundle(bundleIndex)}
                          style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', padding: '0.5rem' }}
                          title="Remove Bundle"
                        >
                          <Trash2 size={20} />
                        </button>
                      </div>

                      <div className="form-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label>Bundle #</label>
                          <input
                            type="text"
                            value={bundle.bundleNumber || ''}
                            onChange={(e) => handleBundleFieldChange(bundleIndex, 'bundleNumber', e.target.value)}
                            placeholder="e.g. Lot A"
                          />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label>Avg Size</label>
                          <input
                            type="text"
                            value={bundle.avgSize || ''}
                            onChange={(e) => handleBundleFieldChange(bundleIndex, 'avgSize', e.target.value)}
                            placeholder='e.g. 121" X 76"'
                          />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label>Location</label>
                          <select
                            value={bundle.location || 'SEATTLE, WA'}
                            onChange={(e) => handleBundleFieldChange(bundleIndex, 'location', e.target.value)}
                            style={{ width: '100%', padding: '0.625rem', borderRadius: '4px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white' }}
                          >
                            {bundleLocations.map(loc => (
                              <option key={loc} value={loc} style={{ background: '#1c1c1e' }}>{loc}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>

                    <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: '#ccc' }}>Bundle Images</label>
                    <div className="image-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '8px' }}>
                      {(bundle.images || []).map((img, imgIndex) => (
                        <div key={imgIndex} style={{ position: 'relative', aspectRatio: '1' }}>
                          <img
                            src={img}
                            alt={`Bundle ${bundleIndex + 1} Image ${imgIndex + 1}`}
                            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '4px' }}
                          />
                          <button
                            type="button"
                            onClick={() => handleRemoveBundleImage(bundleIndex, imgIndex)}
                            style={{
                              position: 'absolute', top: -5, right: -5,
                              background: '#ef4444', color: 'white',
                              borderRadius: '50%', width: '20px', height: '20px',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              border: 'none', cursor: 'pointer', padding: 0
                            }}
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))}

                      <div className="add-image-box" style={{
                        border: '2px dashed rgba(255,255,255,0.2)',
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        position: 'relative',
                        aspectRatio: '1',
                        cursor: 'pointer'
                      }}>
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={(e) => handleBundleImageUpload(e, bundleIndex)}
                          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
                        />
                        <Plus size={24} color="rgba(255,255,255,0.5)" />
                      </div>
                    </div>
                  </div>
                ))}

                {(selectedProduct.bundles || []).length === 0 && (
                  <div style={{ textAlign: 'center', padding: '2rem', color: '#666', fontStyle: 'italic' }}>
                    No bundles added yet. Click "Add Bundle" to start.
                  </div>
                )}
              </div>
            ) : (
              /* Installed Images Section (Existing) */
              <div className="form-section">
                <h3>Installed Images (Max 2)</h3>
                <div className="form-grid">
                  {[0, 1].map((index) => (
                    <div key={index} className="form-group">
                      <label>Installed Image {index + 1}</label>
                      <div className="image-input-wrapper">
                        <div className="image-preview">
                          {selectedProduct.installedImages && selectedProduct.installedImages[index] ? (
                            <img
                              src={selectedProduct.installedImages[index]}
                              alt={`Installed ${index + 1}`}
                              onError={(e) => { e.target.src = '/images/products/placeholder.jpg'; }}
                            />
                          ) : (
                            <div className="placeholder-icon">
                              <ImageIcon size={24} color="#666" />
                            </div>
                          )}
                        </div>
                        <div className="image-controls">
                          <div className="file-upload-btn-wrapper">
                            <button className="secondary-btn upload-btn" type="button">
                              Upload
                            </button>
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => handleInstalledImageUpload(e, index)}
                              className="file-input-hidden"
                            />
                          </div>
                          {selectedProduct.installedImages && selectedProduct.installedImages[index] && (
                            <button
                              className="secondary-btn delete-btn-small"
                              type="button"
                              onClick={() => handleDeleteImage(selectedProduct.installedImages[index], 'installed', index)}
                              style={{ marginTop: '0.5rem', borderColor: '#ef4444', color: '#ef4444' }}
                            >
                              <Trash2 size={14} /> Remove
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

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
              {isUploading && (
                <div style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: 'rgba(0, 0, 0, 0.5)',
                  zIndex: 2000,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backdropFilter: 'blur(4px)'
                }}>
                  <div style={{
                    backgroundColor: 'white',
                    padding: '2rem',
                    borderRadius: '12px',
                    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '1rem',
                    minWidth: '300px'
                  }}>
                    <div className="loader-spinner" style={{
                      width: '40px',
                      height: '40px',
                      border: '4px solid #3b82f6',
                      borderTopColor: 'transparent',
                      borderRadius: '50%',
                      animation: 'spin 1s linear infinite'
                    }}></div>
                    <h3 style={{ margin: 0, color: '#1f2937', fontSize: '1.25rem' }}>Uploading Image</h3>
                    <p style={{ margin: 0, color: '#6b7280' }}>Sending to Cloudinary. Please wait...</p>
                  </div>
                </div>
              )}
              <button
                className={`save-btn ${isSaving || isUploading ? 'saving' : ''}`}
                onClick={() => saveData()}
                disabled={isSaving || isUploading}
                style={{ opacity: isUploading ? 0.7 : 1, cursor: isUploading ? 'not-allowed' : 'pointer' }}
              >
                <Save size={18} /> {isUploading ? 'Uploading...' : isSaving ? 'Saving...' : 'Save Changes'}
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
