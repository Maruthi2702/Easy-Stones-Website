export const getImageFileName = (imageUrl = '') => {
  if (!imageUrl) return '';
  const parts = imageUrl.split('/');
  const rawName = decodeURIComponent(parts[parts.length - 1] || '');
  return rawName.replace(/\s+/g, '_');
};

export const getLocalImagePath = (imageUrl = '') => {
  if (!imageUrl) return '';
  if (imageUrl.startsWith('http')) return imageUrl;
  
  const basePath = import.meta.env.BASE_URL || '/';
  // Remove trailing slash from base path if it exists, to avoid double slashes
  const cleanBasePath = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  
  // If path already starts with /images
  if (imageUrl.startsWith('/images')) {
    return `${cleanBasePath}${imageUrl}`;
  }
  
  // Otherwise assume it's a filename in /images/products/
  const filename = getImageFileName(imageUrl);
  return filename ? `${cleanBasePath}/images/products/${filename}` : '';
};

