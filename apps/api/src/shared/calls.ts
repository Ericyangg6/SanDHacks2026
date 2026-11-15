// Writes a row to the `calls` table in Neon, over its HTTPS SQL endpoint (same approach as m4/db.ts; no driver).
// Never logs the raw number or the connection string.
import type { CallDirection, CallOutcome, Channel } from '../../../../data/schema/types';

export interface CallRow {
  direction: CallDirection;
  channel: Channel;
  phone_hash: string | null;
  zip: string | null;
  language: string | null;
  site_id: number | null;
  outcome: CallOutcome | null;
  alert_id?: number | null;
  started_at: Date;
  ended_at: Date | null;
}

export async function insertCall(row: CallRow): Promise<void> {
  const url = (process.env.NEON_DATABASE_URL ?? '').trim().replace(/^"|"$/g, '');
  if (!url) {
    console.warn('[calls] NEON_DATABASE_URL is not set; call row not written');
    return;
  }
  const res = await fetch(`https://${new URL(url).hostname}/sql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Neon-Connection-String': url },
    body: JSON.stringify({
      // An unknown site_id becomes null instead of failing the foreign key.
      query: `insert into calls (direction, channel, phone_hash, zip, language, site_id, outcome, alert_id, started_at, ended_at)
              values ($1::call_direction, $2::channel, $3, $4, $5, (select id from sites where id = $6::int),
                      $7::call_outcome, $8::int, $9::timestamptz, $10::timestamptz)`,
      params: [
        row.direction, row.channel, row.phone_hash, row.zip, row.language, row.site_id, row.outcome,
        row.alert_id ?? null, row.started_at.toISOString(), row.ended_at?.toISOString() ?? null,
      ],
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    const detail = ((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `HTTP ${res.status}`;
    throw new Error(`calls insert failed: ${detail}`);
  }
}
