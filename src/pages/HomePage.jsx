import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import ProductGrid from '../components/ProductGrid';
import HeroCarousel from '../components/HeroCarousel';
import CategoryNav from '../components/CategoryNav';
import { API_URL } from '../config/api';

const HomePage = () => {
  const location = useLocation();
  const [activeCategory, setActiveCategory] = useState('Moda Quartz');
  const [searchTerm, setSearchTerm] = useState('');
  // Initialize with empty array and loading state
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const response = await fetch(`${API_URL}/api/products`, {
          credentials: 'include' // Send cookies with request
        });
        if (response.ok) {
          const data = await response.json();
          if (data && Array.isArray(data)) {
            console.log(`Fetched ${data.length} products from API`);
            setProducts(data);
          }
        } else {
          console.error('Failed to fetch products:', response.statusText);
        }
      } catch (error) {
        console.error('Error fetching products:', error);
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
        onSearchChange={setSearchTerm}
        activeCategory={activeCategory}
        products={products}
        loading={loading}
      />
    </>
  );
};

export default HomePage;

