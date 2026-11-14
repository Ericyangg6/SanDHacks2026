// Writes a row to the `calls` table.
// STUB until there's a shared Neon client: logs the row instead. Swap the body for an INSERT.
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
  console.log('[calls stub] insert', { ...row, phone_hash: row.phone_hash?.slice(0, 8) });
}
