// API Configuration
// This file centralizes API URL configuration for easy deployment

const getApiUrl = () => {
  // In production, use relative path (empty string) so requests go to the same origin
  if (import.meta.env.PROD) {
    return '';
  }
  // In development, use localhost
  return import.meta.env.VITE_API_URL || 'http://localhost:3001';
};

export const API_URL = getApiUrl();

// API Endpoints
export const API_ENDPOINTS = {
  UPLOAD: `${API_URL}/api/upload`,
  SAVE_PRODUCTS: `${API_URL}/api/products/save`,
  HEALTH: `${API_URL}/api/health`,
};
