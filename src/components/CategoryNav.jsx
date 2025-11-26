import React from 'react';
import './CategoryNav.css';

const CategoryNav = ({ activeCategory, onCategoryChange }) => {
    const categories = [
        { id: 'Moda Quartz', label: 'Moda Quartz' },
        { id: 'MODA PST', label: 'MODA PST' },
        { id: 'Quartzite', label: 'Quartzite' },
        { id: 'Granite', label: 'Granite' },
        { id: 'Marble', label: 'Marble' }
    ];

    return (
        <div className="category-nav-container">
            <nav className="category-nav">
                {categories.map((category) => (
                    <button
                        key={category.id}
                        className={`category-tab ${activeCategory === category.id ? 'active' : ''}`}
                        onClick={() => onCategoryChange(category.id)}
                    >
                        {category.label}
                    </button>
                ))}
            </nav>
        </div>
    );
};

export default CategoryNav;
