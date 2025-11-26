import React, { useState, Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Header from './components/Header';
import Footer from './components/Footer';
import ScrollToTop from './components/ScrollToTop';
import './App.css';

// Lazy load pages
const HomePage = lazy(() => import('./pages/HomePage'));
const ProductDetail = lazy(() => import('./pages/ProductDetail'));
const AdminPage = lazy(() => import('./pages/AdminPage'));

// Loading component
const PageLoader = () => (
  <div className="page-loader">
    <div className="loader-spinner"></div>
  </div>
);

function App() {
  const [searchTerm, setSearchTerm] = useState('');

  return (
    <div className="app">
      <ScrollToTop />
      <div className="bg-gradient"></div>
      <Header searchValue={searchTerm} onSearchChange={setSearchTerm} />
      <main>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<HomePage searchTerm={searchTerm} />} />
            <Route path="/product" element={<Navigate to="/" replace />} />
            <Route path="/product/:productId" element={<ProductDetail />} />
            <Route path="/admin" element={<AdminPage />} />
          </Routes>
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}

export default App;
