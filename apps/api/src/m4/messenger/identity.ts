import { createHash } from 'node:crypto';
import { env } from '../env';

// Facebook Messenger addresses, as Twilio sends them: `messenger:<id>`. Inbound, From is the person's
// page-scoped id (PSID) and To is the Facebook Page id. Neither is a phone number, so nothing here goes near
// toE164 or hashPhone. Like a phone number, a PSID is never stored or logged: rows carry hashMessengerId.

const PREFIX = 'messenger:';
// Meta's ids are numeric strings. Anything else is refused rather than guessed at.
const ID = /^\d{1,64}$/;

// The bare id from a `messenger:<id>` address, or null when the value is not one.
export function parseMessengerAddress(raw: string): string | null {
  const value = raw.trim();
  if (!value.startsWith(PREFIX)) return null;
  const id = value.slice(PREFIX.length);
  return ID.test(id) ? id : null;
}

export function messengerAddress(id: string): string {
  return PREFIX + id;
}

// Hex digest, stored where a phone_hash goes (messages.phone_hash, calls.phone_hash). The 'messenger:' prefix
// keeps it apart from every phone hash, whose input starts with '+'.
export function hashMessengerId(psid: string): string {
  return createHash('sha256').update(env.phoneSalt() + PREFIX + psid).digest('hex');
}

// For log lines only: a short piece of the salted hash, which cannot be turned back into the id.
export function messengerLogLabel(contactHash: string): string {
  return `messenger:${contactHash.slice(0, 8)}`;
}
