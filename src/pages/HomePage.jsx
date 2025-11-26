import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import ProductGrid from '../components/ProductGrid';
import HeroCarousel from '../components/HeroCarousel';
import CategoryNav from '../components/CategoryNav';
import { API_URL } from '../config/api';
// Fallback data in case API fails initially or for static build
import { products as fallbackProducts } from '../data/products';

const HomePage = ({ searchTerm }) => {
  const location = useLocation();
  const [activeCategory, setActiveCategory] = useState('Moda Quartz');
  // Initialize with fallback data immediately so user sees something while API wakes up
  const [products, setProducts] = useState(fallbackProducts);
  const [loading, setLoading] = useState(false); // Don't show full page loader

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
        // Keep using fallback data (already set)
      } finally {
        setLoading(false);
      }
    };

    fetchProducts();
  }, []);

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
        activeCategory={activeCategory}
        products={products}
        loading={loading}
      />
    </>
  );
};

export default HomePage;

