import type { Loose } from '../types/records.ts';
import { MANAGE_VOICE_WORDS } from './assistantContract.ts';

/**
 * Who opens Admin → Voice Assistant (Words, Usage, Speech test): anyone holding `manage_voice_words` (Users & Roles → Voice assistant)
 * and the admin role, which also had the old Voice Test page. The server checks the same switch on every call; this only hides the page.
 */
export const canManageVoiceWords = (user: Loose | null | undefined): boolean =>
  !!user && (user.role === 'admin' || !!user.permissions?.includes(MANAGE_VOICE_WORDS));
