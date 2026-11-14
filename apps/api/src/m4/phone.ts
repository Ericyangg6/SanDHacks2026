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

// For log lines only.
export function maskPhone(e164: string): string {
  return `${e164.slice(0, 2)}***${e164.slice(-2)}`;
}
