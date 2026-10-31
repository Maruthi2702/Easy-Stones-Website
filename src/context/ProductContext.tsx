import React, { createContext, useState, useContext, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { API_URL } from '../config/api';
import { useAuth } from './AuthContext';
import { publicProduct } from '../utils/productView';

export type Product = {
    id: string | number;
    name: string;
    category: string;
    availability: string;
    image: string;
    collectionType?: string;
    isNewArrival?: boolean;
    showInSlider?: boolean;
    [key: string]: unknown;
};
export type ProductContextValue = {
    products: Product[];
    loading: boolean;
    error: string | null;
    refreshProducts: () => void;
};
const ProductContext = createContext<ProductContextValue | undefined>(undefined);

export const useProducts = (): ProductContextValue => {
    const context = useContext(ProductContext);
    if (!context) {
        throw new Error('useProducts must be used within a ProductProvider');
    }
    return context;
};

export const ProductProvider = ({ children }: { children: ReactNode }) => {
    const { user, loading: authLoading } = useAuth();
    const requestVersion = useRef(0);
    const [products, setProducts] = useState<Product[]>(() => {
        try {
            const cached = localStorage.getItem('cached_products');
            const data: Product[] = cached ? JSON.parse(cached) : [];
            const safe = Array.isArray(data) ? data.map(publicProduct) : [];
            // Strip costs and tiers left behind by older builds too.
            localStorage.setItem('cached_products', JSON.stringify(safe));
            return safe;
        } catch {
            return [];
        }
    });
    const [loading, setLoading] = useState(() => products.length === 0);
    const [error, setError] = useState<string | null>(null);

    const fetchProducts = useCallback(async () => {
        const version = ++requestVersion.current;
        try {
            const response = await fetch(`${API_URL}/api/products`, {
                credentials: 'include'
            });
            if (response.ok) {
                const data = await response.json();
                if (version !== requestVersion.current) return;
                if (Array.isArray(data)) {
                    setProducts(data);
                    // Cache to local storage
                    try {
                        localStorage.setItem('cached_products', JSON.stringify(data.map(publicProduct)));
                    } catch (e) {
                        console.warn('Failed to cache products', e);
                    }
                    setError(null);
                }
                setLoading(false); // Set loading false ONLY after products are set
            } else {
                if (version !== requestVersion.current) return;
                setError('Failed to fetch products');
                setLoading(false);
            }
        } catch (err) {
            if (version !== requestVersion.current) return;
            console.error('Error fetching products:', err);
            setError('Connection error');
            setLoading(false);
        }
    }, []);

    // Pricing follows the current session; an old request cannot put the last
    // customer's price back after a logout or account switch.
    const mayViewPrices = user?.role === 'admin' || user?.permissions?.includes('view_product_prices');
    useEffect(() => {
        setProducts(current => current.map(publicProduct));
        if (authLoading) return;
        fetchProducts();
        return () => { requestVersion.current++; };
    }, [authLoading, user?.id, user?.type, mayViewPrices, fetchProducts]);

    const refreshProducts = fetchProducts;

    return (
        <ProductContext.Provider value={{ products, loading, error, refreshProducts }}>
            {children}
        </ProductContext.Provider>
    );
};

export default ProductContext;
