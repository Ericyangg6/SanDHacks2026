// Help requests: a caller asks for a pickup, a ride or a check. A dispatcher answers on the dashboard.
// The agent only reports status. It reads `say_this`, which this file chooses from the request row.
import { z } from 'zod';
import type { HelpRequest, RequestHelpOutput, RequestStatus } from '../../../../data/schema/types';
import { db } from '../shared/db';
import { resolveLocation } from '../shared/find-sites';

const FAILED =
  "I couldn't send your request. Please call 2 1 1. They can help, and they can arrange a free ride. If this is an emergency, call 9 1 1.";

/** The only place a status becomes words. Nothing here says help is confirmed. */
export function sayThis(status: RequestStatus): string {
  if (status === 'requesting') {
    return "I've sent your request to a dispatcher. No one has confirmed it yet, so I can't tell you that help is coming.";
  }
  return 'Your request is on file. I have no update that I can confirm.';
}

export const requestHelpBody = z.object({
  said: z.string().trim().min(1).max(1000),
  location: z.string().trim().min(1).max(300),
  needs: z.array(z.string().trim().min(1).max(60)).max(8).optional().catch(undefined),
  language: z.enum(['en', 'es', 'tl', 'vi', 'zh']).optional().catch(undefined),
  caller_id: z.string().optional(),
  conversation_id: z.string().optional(),
});

export async function handleRequestHelp(body: z.infer<typeof requestHelpBody>): Promise<RequestHelpOutput> {
  if (!db) return { ok: false, say_this: FAILED };
  try {
    // A request with no map position is still a request: a failed lookup must not block it.
    const loc = await resolveLocation({ location: body.location }).catch(() => null);
    const phone = body.caller_id?.trim();
    const inserted = await db.query(
      `insert into requests (conversation_id, said, location, zip, lat, lon, needs, language, phone_e164)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (conversation_id) do nothing
       returning id, status`,
      [
        body.conversation_id || null, body.said, body.location, loc?.zip ?? null, loc?.pt.lat ?? null, loc?.pt.lon ?? null,
        body.needs ?? [], body.language ?? null, phone && /^\+\d{10,15}$/.test(phone) ? phone : null,
      ],
    );
    // No row back means this call already has a request: report that one instead of filing a second.
    const row =
      inserted.rows[0] ??
      (await db.query(`select id, status from requests where conversation_id = $1`, [body.conversation_id])).rows[0];
    return { ok: true, request_id: row.id, status: row.status, say_this: sayThis(row.status) };
  } catch (err) {
    console.error('[requests] request_help failed', err);
    return { ok: false, say_this: FAILED };
  }
}

/** Columns the inbox may see. `phone_e164` is deliberately absent. */
export const INBOX_COLUMNS = 'id, status, help_type, said, location, zip, lat, lon, needs, language, created_at';

export async function listOpenRequests(): Promise<HelpRequest[]> {
  if (!db) return [];
  const { rows } = await db.query(
    `select ${INBOX_COLUMNS} from requests where status in ('requesting', 'incoming') order by created_at`,
  );
  return rows;
}
