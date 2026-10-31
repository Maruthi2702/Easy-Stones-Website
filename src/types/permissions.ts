/** Minimal principal accepted by permission helpers on the server and client. */
export type PermissionUser = {
  permissions?: readonly string[];
  role?: string;
} | null | undefined;
