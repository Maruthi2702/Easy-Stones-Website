import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import ProductGrid from '../components/ProductGrid';
import HeroCarousel from '../components/HeroCarousel';
import CategoryNav from '../components/CategoryNav';
import { useProducts } from '../context/ProductContext';

const HomePage = () => {
  const location = useLocation();
  const [activeCategory, setActiveCategory] = useState('Moda Quartz');
  const [searchTerm, setSearchTerm] = useState('');

  // Use global product context
  const { products, loading } = useProducts();

  useEffect(() => {
    if (location.state?.activeCategory) {
      setActiveCategory(location.state.activeCategory);
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  return (
    <>
      <HeroCarousel />
      <CategoryNav
        activeCategory={activeCategory}
        onCategoryChange={setActiveCategory}
      />
      <ProductGrid
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        activeCategory={activeCategory}
        products={products}
        loading={loading}
      />
    </>
  );
};

export default HomePage;

