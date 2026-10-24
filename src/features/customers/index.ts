// The Customers module (MIGRATION_NOTES.md §4, step A5): the profile and what can be done to an open customer.
export { useCustomerActions } from './useCustomerActions';
export type { CustomerActionsDeps, ContactForm } from './useCustomerActions';
export { CustomerProfile, ContactModal, LinkPartnerModal } from './profile';
export type { CustomerProfileProps } from './profile';
export { useOpenCustomer } from './useOpenCustomer';
export type { OpenCustomerDeps } from './useOpenCustomer';
export { getCustomerLevelLabel, getPriceLevelLabel } from './customerLevel';
export { useCustomersPage } from './useCustomersPage';
