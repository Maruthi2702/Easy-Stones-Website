import React, { useState, useMemo } from 'react';
import { useProducts } from '../../context/ProductContext';
import { Search, Loader2, Tag, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import './PriceListPanel.css';

const PriceListPanel = ({ sidebarToggle }) => {
    const { products, loading, error } = useProducts();
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('All');
    const [sortBy, setSortBy] = useState('name'); // 'name', 'category', 'level1', 'level2', 'level3', 'level4'
    const [sortOrder, setSortOrder] = useState('asc'); // 'asc', 'desc'

    // Extract unique categories dynamically from products
    const categories = useMemo(() => {
        if (!products || products.length === 0) return ['All'];
        const list = new Set(products.map(p => p.category).filter(Boolean));
        return ['All', ...Array.from(list)];
    }, [products]);

    // Handle sort click
    const handleSort = (field) => {
        if (sortBy === field) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortBy(field);
            setSortOrder('asc');
        }
    };

    // Filter and sort products
    const processedProducts = useMemo(() => {
        if (!products) return [];

        let result = products.filter(p => {
            const matchesSearch = (p.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                                 (p.category || '').toLowerCase().includes(searchTerm.toLowerCase());
            const matchesCategory = selectedCategory === 'All' || p.category === selectedCategory;
            return matchesSearch && matchesCategory;
        });

        // Sort
        result.sort((a, b) => {
            let valA = '';
            let valB = '';

            if (sortBy === 'name') {
                valA = a.name || '';
                valB = b.name || '';
            } else if (sortBy === 'category') {
                valA = a.category || '';
                valB = b.category || '';
            } else if (sortBy.startsWith('level')) {
                const levelKey = sortBy; // 'level1', 'level2', etc.
                valA = a.priceLevels?.[levelKey] ?? -1;
                valB = b.priceLevels?.[levelKey] ?? -1;
            }

            if (typeof valA === 'number' && typeof valB === 'number') {
                return sortOrder === 'asc' ? valA - valB : valB - valA;
            }

            // String sort fallback
            valA = String(valA).toLowerCase();
            valB = String(valB).toLowerCase();
            if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
            if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
            return 0;
        });

        return result;
    }, [products, searchTerm, selectedCategory, sortBy, sortOrder]);

    const renderSortHeader = (label, field) => {
        const isSorted = sortBy === field;
        return (
            <th onClick={() => handleSort(field)} className="plp-sortable-header">
                <div className="plp-header-cell-content">
                    <span>{label}</span>
                    {isSorted ? (
                        sortOrder === 'asc' ? <ArrowUp size={12} className="plp-sort-arrow" /> : <ArrowDown size={12} className="plp-sort-arrow" />
                    ) : (
                        <ArrowUpDown size={12} className="plp-sort-arrow-placeholder" />
                    )}
                </div>
            </th>
        );
    };

    return (
        <div className="plp-root">
            <div className="plp-page-header">
                <div className="plp-header-left">
                    {sidebarToggle}
                    <div className="plp-icon-wrap">
                        <Tag size={20} />
                    </div>
                    <div>
                        <h1 className="plp-title">Product Price List</h1>
                        <p className="plp-subtitle">
                            Viewing {processedProducts.length} of {products.length} catalog items
                        </p>
                    </div>
                </div>

                <div className="plp-header-actions">
                    <div className="plp-search-wrap">
                        <Search size={14} className="plp-search-icon" />
                        <input
                            type="text"
                            className="plp-search"
                            placeholder="Search by name, category..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>
            </div>

            {/* Category Filter Pills */}
            <div className="plp-category-filter">
                {categories.map((cat) => (
                    <button
                        key={cat}
                        type="button"
                        onClick={() => setSelectedCategory(cat)}
                        className={`plp-category-pill ${selectedCategory === cat ? 'active' : ''}`}
                    >
                        {cat}
                    </button>
                ))}
            </div>

            {/* Price list content */}
            <div className="plp-table-card">
                {loading ? (
                    <div className="plp-state-center">
                        <Loader2 size={36} className="plp-spin plp-gold" />
                        <p>Loading price list...</p>
                    </div>
                ) : error ? (
                    <div className="plp-state-center">
                        <p className="plp-error-text">{error}</p>
                    </div>
                ) : processedProducts.length === 0 ? (
                    <div className="plp-state-center">
                        <h3>No products found</h3>
                        <p>Try adjusting your search filters.</p>
                    </div>
                ) : (
                    <>
                        {/* Desktop Table View */}
                        <div className="plp-table-scroll plp-desktop-only">
                            <table className="plp-table">
                                <thead>
                                    <tr>
                                        <th style={{ width: '60px' }}>IMAGE</th>
                                        {renderSortHeader('PRODUCT NAME', 'name')}
                                        {renderSortHeader('CATEGORY', 'category')}
                                        {renderSortHeader('LEVEL 1 (FAB)', 'level1')}
                                        {renderSortHeader('LEVEL 2', 'level2')}
                                        {renderSortHeader('LEVEL 3 (DEF)', 'level3')}
                                        {renderSortHeader('LEVEL 4', 'level4')}
                                        <th style={{ width: '100px', textAlign: 'center' }}>STATUS</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {processedProducts.map((p) => {
                                        const isOutOfStock = p.inventoryStatus === 'out-of-stock';
                                        return (
                                            <tr key={p._id || p.id}>
                                                <td>
                                                    <div className="plp-image-container">
                                                        <img
                                                            src={p.image || '/logo.png'}
                                                            alt={p.name}
                                                            className="plp-product-img"
                                                            onError={(e) => { e.target.src = '/logo.png'; }}
                                                        />
                                                    </div>
                                                </td>
                                                <td>
                                                    <span className="plp-product-name">{p.name}</span>
                                                </td>
                                                <td>
                                                    <span className="plp-product-cat">{p.category || '—'}</span>
                                                </td>
                                                <td>
                                                    <span className="plp-price-val font-semibold">
                                                        {p.priceLevels?.level1 ? `$${p.priceLevels.level1.toFixed(2)}` : '—'}
                                                    </span>
                                                </td>
                                                <td>
                                                    <span className="plp-price-val">
                                                        {p.priceLevels?.level2 ? `$${p.priceLevels.level2.toFixed(2)}` : '—'}
                                                    </span>
                                                </td>
                                                <td>
                                                    <span className="plp-price-val font-semibold text-gold">
                                                        {p.priceLevels?.level3 ? `$${p.priceLevels.level3.toFixed(2)}` : '—'}
                                                    </span>
                                                </td>
                                                <td>
                                                    <span className="plp-price-val">
                                                        {p.priceLevels?.level4 ? `$${p.priceLevels.level4.toFixed(2)}` : '—'}
                                                    </span>
                                                </td>
                                                <td style={{ textAlign: 'center' }}>
                                                    <span className={`plp-status-badge ${isOutOfStock ? 'out-of-stock' : 'in-stock'}`}>
                                                        {isOutOfStock ? 'Out of Stock' : 'In Stock'}
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {/* Mobile Cards View */}
                        <div className="plp-mobile-list plp-mobile-only">
                            {processedProducts.map((p) => {
                                const isOutOfStock = p.inventoryStatus === 'out-of-stock';
                                return (
                                    <div key={p._id || p.id} className="plp-mobile-card">
                                        <div className="plp-card-top">
                                            <div className="plp-image-container">
                                                <img
                                                    src={p.image || '/logo.png'}
                                                    alt={p.name}
                                                    className="plp-product-img"
                                                    onError={(e) => { e.target.src = '/logo.png'; }}
                                                />
                                            </div>
                                            <div className="plp-card-header-info">
                                                <h4 className="plp-mobile-product-name">{p.name}</h4>
                                                <div className="plp-card-meta-row">
                                                    <span className="plp-card-cat-badge">{p.category || 'Quartz'}</span>
                                                    <span className={`plp-status-badge ${isOutOfStock ? 'out-of-stock' : 'in-stock'}`}>
                                                        {isOutOfStock ? 'Out of Stock' : 'In Stock'}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="plp-card-prices-grid">
                                            <div className="plp-price-grid-item primary">
                                                <span className="plp-price-label">Level 1 (Fab)</span>
                                                <span className="plp-price-value">
                                                    {p.priceLevels?.level1 ? `$${p.priceLevels.level1.toFixed(2)}` : '—'}
                                                </span>
                                            </div>
                                            <div className="plp-price-grid-item">
                                                <span className="plp-price-label">Level 2</span>
                                                <span className="plp-price-value">
                                                    {p.priceLevels?.level2 ? `$${p.priceLevels.level2.toFixed(2)}` : '—'}
                                                </span>
                                            </div>
                                            <div className="plp-price-grid-item highlighted">
                                                <span className="plp-price-label">Level 3 (Def)</span>
                                                <span className="plp-price-value">
                                                    {p.priceLevels?.level3 ? `$${p.priceLevels.level3.toFixed(2)}` : '—'}
                                                </span>
                                            </div>
                                            <div className="plp-price-grid-item">
                                                <span className="plp-price-label">Level 4</span>
                                                <span className="plp-price-value">
                                                    {p.priceLevels?.level4 ? `$${p.priceLevels.level4.toFixed(2)}` : '—'}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default PriceListPanel;
