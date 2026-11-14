import { createHmac, timingSafeEqual } from 'node:crypto';

const safeEqual = (a: string, b: string) => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};

/** Server-tool calls carry the shared secret we configured on the tool (agent/tools/*.ts). */
export function isValidToolSecret(header: string | undefined): boolean {
  const secret = process.env.EL_TOOL_SECRET;
  return !!secret && !!header && safeEqual(header, secret);
}

/**
 * Post-call webhook signature: `ElevenLabs-Signature: t=<unix>,v0=<hex>`,
 * where v0 = HMAC-SHA256(secret, `${t}.${rawBody}`). Rejects anything older than 30 minutes.
 */
export function isValidWebhookSignature(rawBody: string, header: string | undefined): boolean {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=', 2) as [string, string]));
  const t = Number(parts.t);
  if (!parts.v0 || !Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > 30 * 60) return false;
  const expected = createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
  return safeEqual(parts.v0, expected);
}
