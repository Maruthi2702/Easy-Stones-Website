// 3rd-Party Freight (MIGRATION_NOTES.md §4, step B). The Sales shell
// lazy-loads FreightTab.tsx itself — `import('../freight/FreightTab')` in
// SalesTabViews — so the page keeps its own chunk and its CSS keeps its place;
// anything else outside this folder imports from here.
export { default as FreightTab } from './FreightTab';
export type { FreightTabProps } from './FreightTab';
export type { FreightCharge, CarrierGroup } from './freightView';
