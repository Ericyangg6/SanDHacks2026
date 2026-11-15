// The trail a dispatcher reads: one row per thing that happened on a call (call_events).
// Logging is best effort. It never throws and never delays a tool result the caller is waiting on.
import type { CallEvent, CallEventKind } from '../../../../data/schema/types';
import { db } from '../shared/db';

const ANSWERED = 'Shade answered the call';

/** `at` is for backfilled or mock events; live events take the database clock. */
export async function logEvent(conversationId: string | undefined | null, kind: CallEventKind, text: string, at?: Date): Promise<void> {
  if (!db || !conversationId) return;
  try {
    // Every trail starts with call_started. The call-start webhook normally writes it; when that webhook is not
    // configured, the first tool call does, a moment before its own event.
    await db.query(
      `insert into call_events (conversation_id, kind, text, at)
       values ($1, 'call_started', $2, coalesce($3::timestamptz, now()) - interval '1 millisecond')
       on conflict (conversation_id) where kind = 'call_started' do nothing`,
      [conversationId, ANSWERED, at ?? null],
    );
    if (kind !== 'call_started') {
      await db.query(`insert into call_events (conversation_id, kind, text, at) values ($1, $2, $3, coalesce($4::timestamptz, now()))`,
        [conversationId, kind, text.slice(0, 300), at ?? null]);
    }
  } catch (err) {
    console.error('[events] log failed', (err as Error).message);
  }
}

/** SQL expression: the trail of the conversation in `col`, oldest first. */
export const eventsOf = (col: string) =>
  `coalesce((select json_agg(json_build_object('at', e.at, 'kind', e.kind, 'text', e.text) order by e.at, e.id)
             from call_events e where e.conversation_id = ${col}), '[]'::json)`;

export interface LiveCall { id: number; started_at: string; events: CallEvent[] }

/** Calls Shade is on right now that have not asked for help: active in the last 15 minutes and not ended. */
export async function listLiveCalls(): Promise<LiveCall[]> {
  if (!db) return [];
  const { rows } = await db.query(
    `select min(e.id)::int id, min(e.at) started_at,
            json_agg(json_build_object('at', e.at, 'kind', e.kind, 'text', e.text) order by e.at, e.id) events
     from call_events e
     where not exists (select 1 from requests r where r.conversation_id = e.conversation_id)
     group by e.conversation_id
     having max(e.at) > now() - interval '15 minutes' and not bool_or(e.kind = 'call_ended')
     order by min(e.at)`,
  );
  return rows;
}
