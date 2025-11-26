import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import ProductGrid from '../components/ProductGrid';
import HeroCarousel from '../components/HeroCarousel';
import CategoryNav from '../components/CategoryNav';

const HomePage = ({ searchTerm }) => {
  const location = useLocation();
  const [activeCategory, setActiveCategory] = useState('Moda Quartz');

  useEffect(() => {
    if (location.state?.activeCategory) {
      setActiveCategory(location.state.activeCategory);
      // Clear state after using it to prevent sticky state on refresh if desired, 
      // but keeping it might be better for UX. 
      // For now, we just set it.
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
        activeCategory={activeCategory}
      />
    </>
  );
};

export default HomePage;

