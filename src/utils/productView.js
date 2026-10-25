const PUBLIC_FIELDS = [
  'id', 'name', 'category', 'collectionType', 'availability', 'image', 'colors',
  'installedImages', 'bundles', 'isNewArrival', 'showInSlider', 'thickness',
  'sizes', 'description', 'primaryColor', 'accentColor', 'style', 'variations',
  'finishes', 'applications', 'bookMatch'
];

// Also used for the browser cache: never persist customer-specific pricing.
export function publicProduct(product) {
  const result = Object.fromEntries(PUBLIC_FIELDS.filter(key => product[key] !== undefined).map(key => [key, product[key]]));
  result.collection = product.collectionType ?? product.collection;
  return result;
}
