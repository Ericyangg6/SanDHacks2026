import { createHash } from 'node:crypto';

/** sha256(PHONE_SALT + e164), per data/schema/contracts.md. Never store or log raw numbers. */
export function hashPhone(e164: string): string {
  const salt = process.env.PHONE_SALT;
  if (!salt) throw new Error('PHONE_SALT is not set');
  return createHash('sha256').update(salt + e164).digest('hex');
}

/** For logs only: "+1******1234". */
export function maskPhone(e164: string): string {
  return e164.length > 4 ? e164.slice(0, 2) + '*'.repeat(e164.length - 6) + e164.slice(-4) : '****';
}
