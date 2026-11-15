import { createHash } from 'node:crypto';
import { env } from './env';

// E.164 in transit, sha256(PHONE_SALT + e164) at rest. Never store or log a raw number.

export function toE164(raw: string, defaultCountryCode = '1'): string | null {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+${defaultCountryCode}${digits}`;
  if (digits.length === 11 && digits.startsWith(defaultCountryCode)) return `+${digits}`;
  return null;
}

// Hex digest. M3 hashes inbound callers into calls.phone_hash and must produce the same value.
export function hashPhone(e164: string): string {
  return createHash('sha256').update(env.phoneSalt() + e164).digest('hex');
}

// WhatsApp addresses, as Twilio sends them: `whatsapp:+<E.164>`. Unlike Messenger, the id is a phone number, so a
// WhatsApp user is hashed and stored exactly like an SMS user (hashPhone of the E.164 number).
const WHATSAPP_PREFIX = 'whatsapp:';

// The E.164 number from a `whatsapp:+...` address, or null when the value is not one.
export function fromWhatsAppAddress(raw: string): string | null {
  const value = raw.trim();
  if (!value.startsWith(WHATSAPP_PREFIX)) return null;
  const number = value.slice(WHATSAPP_PREFIX.length);
  return number.startsWith('+') ? toE164(number) : null;
}

export function whatsAppAddress(e164: string): string {
  return WHATSAPP_PREFIX + e164;
}

// For log lines only.
export function maskPhone(e164: string): string {
  return `${e164.slice(0, 2)}***${e164.slice(-2)}`;
}
