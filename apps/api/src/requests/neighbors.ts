// Neighbor help over Messenger. Volunteers sign up with JOIN <zip> VOLUNTEER (subscribers.volunteer_at). A help
// request goes to every volunteer in the caller's zip, and the first to reply YES <id> takes it. The blast carries the area and needs only; the exact location and the caller's
// callback number go to the neighbor who said yes.
// The caller then gets a Messenger follow-up.
import { getMessengerProfileByPhone, listActiveSubscribersByZips } from '../m4/db';
import { deliverNowIfWindowOpen, queueFollowup } from '../m4/messenger/followups';
import { sendMessengerInWindow } from '../m4/messenger/send';
import { isMessengerContact, type Language, type SubscriberRow } from '../m4/types';
import { db } from '../shared/db';
import { hashPhone } from '../shared/phone';
import { logEvent } from './events';

const es = (language: string | null | undefined) => language === 'es';

export function blastMessage(id: number, area: string, needs: string[], language: string): string {
  const said = needs.length ? (es(language) ? ` Dijeron: ${needs.join(', ')}.` : ` They said: ${needs.join(', ')}.`) : '';
  return es(language)
    ? `Shade: un vecino ${area} necesita ayuda por el calor.${said} ¿Puede ir? Responda SI ${id} y le enviaremos dónde está. Si alguien tiene señales de golpe de calor, llame al 911.`
    : `Shade: a neighbor ${area} needs help in the heat.${said} Can you go to them? Reply YES ${id} and we'll send you where they are. If anyone has signs of heat illness, call 911.`;
}

/** Messages every reachable volunteer in the zip, except the caller, and records how many it reached. Never throws. */
export async function blastNeighbors(r: {
  id: number; conversationId?: string; zip: string | null; area: string; needs: string[]; callerHash: string | null;
}): Promise<void> {
  if (!db) return;
  let reached = 0;
  try {
    if (r.zip) {
      const { rows } = await db.query(
        `select phone_hash from subscribers where zip = $1 and volunteer_at is not null and opted_out_at is null`, [r.zip]);
      const volunteers = new Set(rows.map((v) => v.phone_hash));
      // Messenger only: SMS is carrier-blocked and WhatsApp is parked (src/m4/AGENTS.md).
      const contacts = (await listActiveSubscribersByZips([r.zip]))
        .filter(isMessengerContact)
        .filter((c) => volunteers.has(c.phone_hash) && c.linked_phone_hash !== r.callerHash);
      // All at once: the caller is waiting on the line. Fine for one zip; batch it if a zip grows to thousands.
      const sent = await Promise.all(
        contacts.map((c) => sendMessengerInWindow(c, blastMessage(r.id, r.area, r.needs, c.language), `help request ${r.id}`)),
      );
      reached = sent.filter((s) => s.ok).length;
    }
  } catch (err) {
    console.error(`[neighbors] blast for request ${r.id} failed`, (err as Error).message);
  }
  await db.query(`update requests set neighbors_messaged = $2 where id = $1`, [r.id, reached])
    .catch((err) => console.error(`[neighbors] request ${r.id}: count not saved`, err.message));
  await logEvent(r.conversationId, 'help_requested',
    reached ? `Sent to ${reached} volunteer${reached === 1 ? '' : 's'} in ${r.zip}` : `No volunteer in ${r.zip ?? 'the area'} could be messaged`);
}

const REPLY = /^\s*(yes|si|sí|done|listo)\s*#?\s*(\d{1,9})\s*[.!]*\s*$/i;

/**
 * A neighbor's "YES 12" / "SI 12" (take request 12) or "DONE 12" / "LISTO 12" (finished it), or null.
 * A bare "yes" is left to the text agent.
 */
export function parseReply(body: string): { id: number; done: boolean } | null {
  const m = body.match(REPLY);
  return m ? { id: Number(m[2]), done: /^(done|listo)$/i.test(m[1]) } : null;
}

/**
 * Answers YES <id> and DONE <id> from Messenger, or returns null for anything else.
 * `subscriber` is the sender's row, null when they never sent JOIN.
 */
export async function answerNeighbor(
  subscriber: Pick<SubscriberRow, 'phone_hash' | 'zip' | 'language' | 'opted_out_at'> | null,
  body: string,
): Promise<string | null> {
  const reply = parseReply(body);
  const active = subscriber && !subscriber.opted_out_at ? subscriber : null;
  if (!reply || !active || !db) return null;
  const { id } = reply;
  const spanish = es(active.language);
  const notOpen = spanish ? `La solicitud ${id} no está abierta para usted. Gracias.` : `Request ${id} is not open to you. Thank you.`;

  if (reply.done) {
    // Only the neighbor who took the request can close it.
    const closed = await db.query(
      `update requests set status = 'closed', phone_e164 = null, updated_at = now()
       where id = $1 and status = 'incoming' and volunteer_hash = $2
       returning conversation_id`,
      [id, active.phone_hash],
    );
    if (!closed.rows[0]) return notOpen;
    await logEvent(closed.rows[0].conversation_id, 'closed', 'The neighbor who went marked it done');
    return spanish ? `Gracias por ayudar. La solicitud ${id} está cerrada.` : `Thank you for helping. Request ${id} is closed.`;
  }

  // One statement, so two neighbors can't both win. Only an active volunteer from the request's own zip can take it.
  const won = await db.query(
    `update requests set status = 'incoming', volunteer_hash = $2, updated_at = now()
     where id = $1 and status = 'requesting'
       and zip = (select zip from subscribers where phone_hash = $2 and volunteer_at is not null and opted_out_at is null)
     returning conversation_id`,
    [id, active.phone_hash],
  );
  if (won.rows[0]) {
    await logEvent(won.rows[0].conversation_id, 'help_incoming', 'A neighbor said yes and was sent the location');
    void messageCaller(id);
  }

  const { rows: [r] } = await db.query(`select status, zip, volunteer_hash, location, needs, said, phone_e164 from requests where id = $1`, [id]);
  if (r && r.zip === active.zip && r.volunteer_hash === active.phone_hash && r.status === 'incoming') {
    const needs = r.needs.length ? (spanish ? `\nNecesitan: ${r.needs.join(', ')}` : `\nThey need: ${r.needs.join(', ')}`) : '';
    const phone = r.phone_e164 ? (spanish ? `\nSu número: ${r.phone_e164}` : `\nTheir number: ${r.phone_e164}`) : '';
    const said = r.said.slice(0, 500);
    return spanish
      ? `Gracias. Vaya a: ${r.location}${phone}${needs}\nSus palabras: "${said}"\nSi alguien tiene señales de golpe de calor, llame al 911.\nCuando termine, responda LISTO ${id}.`
      : `Thank you. Go to: ${r.location}${phone}${needs}\nIn their words: "${said}"\nIf anyone has signs of heat illness, call 911.\nWhen you're done, reply DONE ${id}.`;
  }
  if (r && r.zip === active.zip && r.status === 'incoming') {
    return spanish ? 'Gracias. Otro vecino ya dijo que sí.' : 'Thank you. Another neighbor already said yes.';
  }
  return notOpen;
}

/**
 * Tells the caller on Messenger that a neighbor said yes, whether or not they are still on the call. It goes to the
 * profile linked to their phone (JOIN <zip> <phone>): now if they wrote in the last 24 hours, else when they next
 * write. Callers with no linked profile can't be reached: SMS is carrier-blocked. Never throws.
 */
async function messageCaller(id: number): Promise<void> {
  if (!db) return;
  let conversationId: string | null = null;
  try {
    const { rows: [r] } = await db.query(`select phone_e164, language, conversation_id from requests where id = $1`, [id]);
    conversationId = r?.conversation_id ?? null;
    const profile = r?.phone_e164 && process.env.PHONE_SALT ? await getMessengerProfileByPhone(hashPhone(r.phone_e164)) : null;
    if (!profile) {
      await logEvent(conversationId, 'help_incoming', 'Caller has no linked Messenger, so no follow-up was sent');
      return;
    }
    const language: Language = es(r.language) ? 'es' : 'en';
    const body = language === 'es'
      ? 'Un vecino dijo que puede ir a ayudarle. Quédese donde está si puede. Si alguien se siente peor, llame al 911.'
      : 'A neighbor said they can come help you. Stay where you are if you can. If anyone feels worse, call 911.';
    await queueFollowup({ profile, body, siteId: null, language, dedupe: false });
    const now = await deliverNowIfWindowOpen(profile);
    await logEvent(conversationId, 'help_incoming',
      now ? 'Messaged the caller that a neighbor is coming' : 'Follow-up for the caller held until they next write to the Page');
  } catch (err) {
    console.error(`[neighbors] request ${id}: caller follow-up failed`, (err as Error).message);
    await logEvent(conversationId, 'help_incoming', 'Follow-up to the caller failed');
  }
}
