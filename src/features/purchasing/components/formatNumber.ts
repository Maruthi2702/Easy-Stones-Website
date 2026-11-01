export const num = (value: number | null | undefined) =>
  value == null ? '—' : value.toLocaleString('en-US', { maximumFractionDigits: 2 });
