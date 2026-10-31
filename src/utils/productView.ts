const PUBLIC_FIELDS = [
  'id', 'name', 'category', 'collectionType', 'availability', 'image', 'colors',
  'installedImages', 'bundles', 'isNewArrival', 'showInSlider', 'thickness',
  'sizes', 'description', 'primaryColor', 'accentColor', 'style', 'variations',
  'finishes', 'applications', 'bookMatch'
] as const;

type PublicProduct<T> = Pick<T, Extract<(typeof PUBLIC_FIELDS)[number], keyof T>> & { collection: unknown };

// Also used for the browser cache: never persist customer-specific pricing.
export function publicProduct<T extends object>(product: T): PublicProduct<T> {
  const fields = product as Record<string, unknown>;
  const result = Object.fromEntries(PUBLIC_FIELDS.filter(key => fields[key] !== undefined).map(key => [key, fields[key]]));
  result.collection = fields.collectionType ?? fields.collection;
  return result as PublicProduct<T>;
}
