// Dashboard → Resources tab: the resources placed at customers (MIGRATION_NOTES.md §4, step A6).
export { default as ResourcesPanel } from './ResourcesPanel';
export type { ResourcesPanelProps } from './ResourcesPanel';
// The rows on their own, for the customer profile's Resources tab (the same look, owner 2026-11-06).
export { ResourceTable, ResourceCards } from './ResourceRows';
export { resourceDay } from './resourceList';
export type { ResourceRowActions } from './ResourceRows';
