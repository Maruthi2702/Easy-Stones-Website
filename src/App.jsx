import React, { useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Header from './components/Header';
import Footer from './components/Footer';
import HomePage from './pages/HomePage';
import ProductDetail from './pages/ProductDetail';
import AdminPage from './pages/AdminPage';
import './App.css';

function App() {
  const [searchTerm, setSearchTerm] = useState('');

  return (
    <div className="app">
      <div className="bg-gradient"></div>
      <Header searchValue={searchTerm} onSearchChange={setSearchTerm} />
      <main>
        <Routes>
          <Route path="/" element={<HomePage searchTerm={searchTerm} />} />
          <Route path="/product" element={<Navigate to="/" replace />} />
          <Route path="/product/:productId" element={<ProductDetail />} />
          <Route path="/admin" element={<AdminPage />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}

export default App;
