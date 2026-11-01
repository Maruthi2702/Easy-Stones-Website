import { createContext, useContext } from 'react';

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


export default ProductContext;
