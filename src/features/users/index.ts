// Users & Roles (MIGRATION_NOTES.md §4, step B): the Users, Roles &
// Permissions and Locations pages, and Side Nav Order. The Sales shell
// lazy-loads the page files itself — `import('../users/UsersRolesTab')` and
// `import('../users/navOrder/NavOrderTab')` in SalesTabViews — so each keeps
// its own chunk and its CSS its place. Everything else outside this folder
// imports from here (the /admin screen reuses the Add / Edit user forms).
export { default as AddUserForm } from './userForm/AddUserForm';
export type { AddUserFormProps } from './userForm/AddUserForm';
export { default as EditUserForm } from './userForm/EditUserForm';
export type { EditUserFormProps, UserAccessFlags } from './userForm/EditUserForm';
export { changeUserAccess, withDriverHandover } from './userForm/userAccess';
export { PAGE_PERMISSIONS, describeRole, isDriverRole } from './roles/pagePermissions';
export type { UsersRolesTabProps, UsersRolesSection } from './UsersRolesTab';
export type { NavOrderTabProps, NavOrder } from './navOrder/NavOrderTab';
export type { UserRecord, RoleRecord, AdminLocation, AccessAction, PageDef, PermissionAction } from './types';
