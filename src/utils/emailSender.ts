/**
 * The name every email is sent under (owner, 2026-11-08: "Easy Surfaces", sent from
 * noreply@easystones.com). Callers add a word for what it is (`${SENDER_NAME} Check-In`);
 * change the name here, not in the callers. Kept out of emailService.ts so tests that
 * stand in for the mailer still get the real name.
 */
export const SENDER_NAME = 'Easy Surfaces';
