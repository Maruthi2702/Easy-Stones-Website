import type { Model } from 'mongoose';
import type { Loose } from '../src/types/records.ts';

// These old scripts referenced a model that was removed when staff accounts
// moved to User. Keep their fail-before-connection behavior, with an actionable
// explanation instead of an unresolved JavaScript import.
function retiredAdminModel(): Model<Loose> {
  throw new Error('This legacy Admin script is retired. Manage staff accounts in Users & Roles; the Admin model no longer exists.');
}

export default retiredAdminModel();
