import { createContext, useState, useContext, useEffect, type ReactNode } from 'react';
import { API_URL } from '../config/api';

/** A product from /api/products (src/models/Product.js), loosely typed. */
export type Product = { [key: string]: unknown };

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
    const [products, setProducts] = useState<Product[]>(() => {
        try {
            const cached = localStorage.getItem('cached_products');
            return cached ? JSON.parse(cached) : [];
        } catch {
            return [];
        }
    });
    const [loading, setLoading] = useState(() => products.length === 0);
    const [error, setError] = useState<string | null>(null);

    const fetchProducts = async () => {
        try {
            // Don't set loading true if we already have products (from cache)
            if (products.length === 0) setLoading(true);

            const response = await fetch(`${API_URL}/api/products`, {
                credentials: 'include'
            });
            if (response.ok) {
                const data = await response.json();
                if (Array.isArray(data)) {
                    setProducts(data);
                    // Cache to local storage
                    try {
                        localStorage.setItem('cached_products', JSON.stringify(data));
                    } catch (e) {
                        console.warn('Failed to cache products', e);
                    }
                    setError(null);
                }
                setLoading(false); // Set loading false ONLY after products are set
            } else {
                setError('Failed to fetch products');
                setLoading(false);
            }
        } catch (err) {
            console.error('Error fetching products:', err);
            setError('Connection error');
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
