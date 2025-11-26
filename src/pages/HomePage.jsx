import React from 'react';
import ProductGrid from '../components/ProductGrid';
import HeroCarousel from '../components/HeroCarousel';

const HomePage = ({ searchTerm }) => {
  return (
    <>
      <HeroCarousel />
      <ProductGrid searchTerm={searchTerm} />
    </>
  );
};

export default HomePage;

