import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import Header from './components/Header';
import Footer from './components/Footer';
import ScrollToTop from './components/ScrollToTop';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProductProvider } from './context/ProductContext';
import { API_URL } from './config/api';
import './App.css';

// Helper for lazy loading with retry logic
const lazyRetry = (componentImport) => {
  return lazy(async () => {
    const pageHasAlreadyBeenForceRefreshed = JSON.parse(
      window.localStorage.getItem('page-has-been-force-refreshed') || 'false'
    );

    try {
      const component = await componentImport();
      window.localStorage.setItem('page-has-been-force-refreshed', 'false');
      return component;
    } catch (error) {
      if (!pageHasAlreadyBeenForceRefreshed) {
        window.localStorage.setItem('page-has-been-force-refreshed', 'true');
        return window.location.reload();
      }
      throw error;
    }
  });
};

// Lazy load pages
const HomePage = lazyRetry(() => import('./pages/HomePage'));
const ProductDetail = lazyRetry(() => import('./pages/ProductDetail'));
const ContactPage = lazyRetry(() => import('./pages/ContactPage'));
const WarrantyPage = lazyRetry(() => import('./pages/WarrantyPage'));
const CustomerLoginPage = lazyRetry(() => import('./pages/CustomerLoginPage'));
const SalesPage = lazyRetry(() => import('./pages/SalesPage'));
const SalesMapPage = lazyRetry(() => import('./pages/SalesMapPage'));
const AdminPage = lazyRetry(() => import('./pages/AdminPage'));
const LoginPage = lazyRetry(() => import('./pages/LoginPage'));
const CheckInPage = lazyRetry(() => import('./pages/CheckInPage'));

import ErrorBoundary from './components/ErrorBoundary';

// Loading component
const PageLoader = () => (
  <div className="page-loader">
    <div className="loader-spinner"></div>
  </div>
);

// Dynamic Home Page Redirect component
const HomeRedirect = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return <PageLoader />;
  }

  // If user is from admin database (admin, director, manager, sales_rep), 
  // redirect to sales page as home
  const isAdminUser = user && ['admin', 'director', 'manager', 'sales_rep'].includes(user.role);

  if (isAdminUser) {
    return <Navigate to="/sales" replace />;
  }

  return <HomePage />;
};

// Protected Route component
const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return <PageLoader />;
  }

  // Check if we have a user and they are from the admin database
  const isAuthorized = user && (user.type === 'internal' || ['admin', 'director', 'manager', 'sales_rep'].includes(user.role));

  return isAuthorized ? children : <Navigate to="/login" replace />;
};

function App() {
  const location = useLocation();
  const isSalesPage = location.pathname.startsWith('/sales');
  const isAdminPage = location.pathname.startsWith('/admin');

  return (
    <AuthProvider>
      <ProductProvider>
        <div className="app">
          <ScrollToTop />
          <div className="bg-gradient"></div>
          <Header />
          <main>
            <ErrorBoundary>
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route path="/" element={<HomeRedirect />} />
                  <Route path="/products" element={<HomePage />} />
                  <Route path="/sales/map" element={<ProtectedRoute><SalesMapPage /></ProtectedRoute>} />
                  <Route
                    path="/sales"
                    element={
                      <ProtectedRoute>
                        <SalesPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route path="/checkin" element={<CheckInPage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                  <Route path="/product/:productId" element={<ProductDetail />} />
                  <Route path="/contact" element={<ContactPage />} />
                  <Route path="/warranty" element={<WarrantyPage />} />
                  <Route path="/login" element={<CustomerLoginPage />} />
                  <Route path="/customer/login" element={<CustomerLoginPage />} />

                  <Route path="/admin/login" element={<LoginPage />} />
                  <Route
                    path="/admin"
                    element={
                      <ProtectedRoute>
                        <AdminPage />
                      </ProtectedRoute>
                    }
                  />
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </main>
          {!isSalesPage && !isAdminPage && <Footer />}
        </div>
      </ProductProvider>
    </AuthProvider>
  );
}

export default App;
