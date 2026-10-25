// The Customers module (MIGRATION_NOTES.md §4, step A5): the profile and what can be done to an open customer.
export { useCustomerActions } from './useCustomerActions';
export type { CustomerActionsDeps, ContactForm } from './useCustomerActions';
export { CustomerProfile, ContactModal, LinkPartnerModal } from './profile';
export type { CustomerProfileProps } from './profile';
export { useOpenCustomer } from './useOpenCustomer';
export type { OpenCustomerDeps } from './useOpenCustomer';
export { getCustomerLevelLabel, getPriceLevelLabel } from './customerLevel';
export { useCustomersPage } from './useCustomersPage';
export { useCreateCustomer } from './useCreateCustomer';
export type { CustomerActions } from './useCustomerActions';
export type { OpenCustomer } from './useOpenCustomer';
// The Customers list (step B): the page is lazy-loaded by its own file
// (salesShell/CustomersList.tsx); the drawer is the panel the Route Planner and
// the dashboard's visit card open too.
export { default as CustomerDrawer } from './list/CustomerDrawer';
export type { CustomerDrawerProps } from './list/CustomerDrawer';
export type { PartnersSheetProps } from './list/PartnersSheet';
