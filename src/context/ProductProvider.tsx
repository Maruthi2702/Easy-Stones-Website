import React, { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { API_URL } from '../config/api';
import { useAuth } from './AuthContext';
import ProductContext from './ProductContext';
import type { Product } from './ProductContext';
import { publicProduct } from '../utils/productView';

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

    const fetchProducts = useCallback((signal?: AbortSignal) => {
        const version = ++requestVersion.current;
        return fetch(`${API_URL}/api/products`, { credentials: 'include', signal })
            .then(async response => {
                if (!response.ok) throw new Error('Failed to fetch products');
                const data = await response.json();
                if (signal?.aborted || version !== requestVersion.current) return;
                if (Array.isArray(data)) {
                    setProducts(data);
                    try {
                        localStorage.setItem('cached_products', JSON.stringify(data.map(publicProduct)));
                    } catch (error) {
                        console.warn('Failed to cache products', error);
                    }
                    setError(null);
                }
                setLoading(false);
            })
            .catch(error => {
                if (signal?.aborted || version !== requestVersion.current) return;
                console.error('Error fetching products:', error);
                setError(error instanceof Error && error.message === 'Failed to fetch products' ? error.message : 'Connection error');
                setLoading(false);
            });
    }, []);

    const invalidateRequests = useCallback(() => { requestVersion.current++; }, []);

    // Pricing follows the current session; an old request cannot put the last
    // customer's price back after a logout or account switch.
    const mayViewPrices = user?.role === 'admin' || user?.permissions?.includes('view_product_prices');
    const session = `${user?.id || ''}:${user?.type || ''}:${Boolean(mayViewPrices)}:${authLoading}`;
    const [previousSession, setPreviousSession] = useState(session);
    if (previousSession !== session) {
        setPreviousSession(session);
        setProducts(current => current.map(publicProduct));
    }
    useEffect(() => {
        if (authLoading) return;
        const controller = new AbortController();
        void fetchProducts(controller.signal);
        return () => { controller.abort(); invalidateRequests(); };
    }, [authLoading, user?.id, user?.type, mayViewPrices, fetchProducts, invalidateRequests]);

    const refreshProducts = () => { void fetchProducts(); };

    return (
        <ProductContext.Provider value={{ products, loading, error, refreshProducts }}>
            {children}
        </ProductContext.Provider>
    );
};
