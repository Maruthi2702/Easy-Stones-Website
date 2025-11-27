import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import Header from './components/Header';
import Footer from './components/Footer';
import ScrollToTop from './components/ScrollToTop';
import { AuthProvider } from './context/AuthContext';
import './App.css';

// Lazy load pages
const HomePage = lazy(() => import('./pages/HomePage'));
const ProductDetail = lazy(() => import('./pages/ProductDetail'));
const ContactPage = lazy(() => import('./pages/ContactPage'));
const WarrantyPage = lazy(() => import('./pages/WarrantyPage'));
const CustomerLoginPage = lazy(() => import('./pages/CustomerLoginPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));

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
        const response = await fetch('/api/auth/verify', {
          credentials: 'include'
        });

        if (response.ok) {
          setIsAuthenticated(true);
        } else {
          setIsAuthenticated(false);
        }
      } catch (error) {
        setIsAuthenticated(false);
      }
    };

    verifyAuth();
  }, []);

  if (isAuthenticated === null) {
    return <PageLoader />;
  }

  return isAuthenticated ? children : <Navigate to="/admin/login" replace />;
};

function App() {
  return (
    <AuthProvider>
      <div className="app">
        <ScrollToTop />
        <div className="bg-gradient"></div>
        <Header />
        <main>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/product" element={<Navigate to="/" replace />} />
              <Route path="/product/:productId" element={<ProductDetail />} />
              <Route path="/contact" element={<ContactPage />} />
              <Route path="/warranty" element={<WarrantyPage />} />
              <Route path="/login" element={<CustomerLoginPage />} />
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
        </main>
        <Footer />
      </div>
    </AuthProvider>
  );
}

export default App;
