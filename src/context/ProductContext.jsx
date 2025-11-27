import React, { createContext, useState, useContext, useEffect } from 'react';
import { API_URL } from '../config/api';

const ProductContext = createContext();

export const useProducts = () => {
    const context = useContext(ProductContext);
    if (!context) {
        throw new Error('useProducts must be used within a ProductProvider');
    }
    return context;
};

export const ProductProvider = ({ children }) => {
    const [products, setProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchProducts = async () => {
        try {
            setLoading(true);
            const response = await fetch(`${API_URL}/api/products`, {
                credentials: 'include'
            });
            if (response.ok) {
                const data = await response.json();
                if (Array.isArray(data)) {
                    setProducts(data);
                    setError(null);
                }
            } else {
                setError('Failed to fetch products');
            }
        } catch (err) {
            console.error('Error fetching products:', err);
            setError('Connection error');
        } finally {
            setLoading(false);
        }
    };

    // Fetch on mount
    useEffect(() => {
        fetchProducts();
    }, []);

    const refreshProducts = () => {
        fetchProducts();
    };

    return (
        <ProductContext.Provider value={{ products, loading, error, refreshProducts }}>
            {children}
        </ProductContext.Provider>
    );
};

export default ProductContext;
