import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import Header from './components/Header';
import Footer from './components/Footer';
import ScrollToTop from './components/ScrollToTop';
import { AuthProvider } from './context/AuthContext';
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

import ErrorBoundary from './components/ErrorBoundary';

// Loading component
const PageLoader = () => (
  <div className="page-loader">
    <div className="loader-spinner"></div>
  </div>
);

// Protected Route component
const ProtectedRoute = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = React.useState(null);
  const navigate = useNavigate();

  React.useEffect(() => {
    const verifyAuth = async () => {
      try {
        const response = await fetch(`${API_URL}/api/auth/verify`, {
          credentials: 'include'
        });

        const data = await response.json();

        if (response.ok && data.valid === true) {
          setIsAuthenticated(true);
        } else {
          setIsAuthenticated(false);
        }
      } catch (error) {
        setIsAuthenticated(false);
      }
    };

    verifyAuth();
  }, [location.pathname]);

  if (isAuthenticated === null) {
    return <PageLoader />;
  }

  return isAuthenticated ? children : <Navigate to="/login" replace />;
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
                  <Route path="/" element={<HomePage />} />
                  <Route path="/product" element={<Navigate to="/" replace />} />
                  <Route path="/product/:productId" element={<ProductDetail />} />
                  <Route path="/contact" element={<ContactPage />} />
                  <Route path="/warranty" element={<WarrantyPage />} />
                  <Route path="/login" element={<CustomerLoginPage />} />
                  <Route
                    path="/sales"
                    element={
                      <ProtectedRoute>
                        <SalesPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/sales/map"
                    element={
                      <ProtectedRoute>
                        <SalesMapPage />
                      </ProtectedRoute>
                    }
                  />
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
