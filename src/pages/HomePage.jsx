import React from 'react';
import ProductGrid from '../components/ProductGrid';

const HomePage = ({ searchTerm }) => {
  return (
    <>
      <section className="hero-section container">
        <h1 className="hero-title">
          <span className="gradient-text">TIMELESS</span> <br />
          ELEGANCE
        </h1>
        <p className="hero-subtitle">
          Discover our premium collection of natural stones.
        </p>
      </section>
      <ProductGrid searchTerm={searchTerm} />
    </>
  );
};

export default HomePage;

