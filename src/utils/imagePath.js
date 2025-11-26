export const getImageFileName = (imageUrl = '') => {
  if (!imageUrl) return '';
  const parts = imageUrl.split('/');
  const rawName = decodeURIComponent(parts[parts.length - 1] || '');
  return rawName.replace(/\s+/g, '_');
};

export const getLocalImagePath = (imageUrl = '') => {
  if (imageUrl.startsWith('http')) return imageUrl;
  const filename = getImageFileName(imageUrl);
  return filename ? `/images/${filename}` : '';
};

