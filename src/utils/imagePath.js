export const getImageFileName = (imageUrl = '') => {
  if (!imageUrl) return '';
  const parts = imageUrl.split('/');
  const rawName = decodeURIComponent(parts[parts.length - 1] || '');
  return rawName.replace(/\s+/g, '_');
};

export const getLocalImagePath = (imageUrl = '') => {
  if (!imageUrl) return '';
  if (imageUrl.startsWith('http')) return imageUrl;
  
  // If path already starts with /images, return it as is
  if (imageUrl.startsWith('/images')) return imageUrl;
  
  // Otherwise assume it's a filename in /images/products/
  const filename = getImageFileName(imageUrl);
  return filename ? `/images/products/${filename}` : '';
};

