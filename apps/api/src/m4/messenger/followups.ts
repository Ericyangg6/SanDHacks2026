import {
  cancelFollowups,
  hasRecentFollowup,
  insertCall,
  insertFollowup,
  insertMessage,
  listPendingFollowups,
  markFollowupDelivered,
} from '../db';
import { followupIntro } from '../sms/templates';
import type { Language, MessengerContact } from '../types';
import { messengerLogLabel } from './identity';
import { sendMessengerReply } from './send';

// Mode 1: after a phone call. When the voice agent's send_sms asks to "text" a caller the site details and the
// caller has a linked Messenger profile (JOIN <zip> <phone>), the details are held here and sent the next time
// they message the Page. Facebook lets the Page write only within 24 hours of the person's last message, and a
// phone call does not count, so sending at once would usually be refused.

// How long a held follow-up waits for the person to write. After that it is dropped.
export const FOLLOWUP_TTL_DAYS = 7;

function reason(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

// The same site is not held twice for one person within this many hours, so send_sms during a call and the
// automatic follow-up when the call ends (followUpAfterCall) do not both go out.
const DEDUPE_HOURS = 2;

// Holds `body` for the profile. Returns false when the same site was already held for them in the last
// DEDUPE_HOURS. Throws on a database failure; send_sms turns that into an error.
export async function queueFollowup(args: {
  profile: MessengerContact;
  body: string;
  siteId: number | null;
  language: Language;
}): Promise<boolean> {
  const since = new Date(Date.now() - DEDUPE_HOURS * 3600_000);
  if (args.siteId != null && (await hasRecentFollowup(args.profile.phone_hash, args.siteId, since))) return false;
  await insertFollowup({
    phoneHash: args.profile.phone_hash,
    body: `${followupIntro(args.language)}\n\n${args.body}`,
    siteId: args.siteId,
    expiresAt: new Date(Date.now() + FOLLOWUP_TTL_DAYS * 24 * 3600_000),
  });
  return true;
}

// Sends everything held for this person, oldest first, as separate messages, right after they wrote (so inside
// the window). Each sent one is marked delivered, saved to messages so the text agent has it as context, and gets
// an outbound calls row. Returns how many went out. Never throws.
export async function deliverFollowups(args: { contactHash: string; psid: string; pageId: string }): Promise<number> {
  const label = messengerLogLabel(args.contactHash);
  let pending;
  try {
    pending = await listPendingFollowups(args.contactHash);
  } catch (error) {
    console.error(`[m4] follow-ups for ${label} not checked (${reason(error)})`);
    return 0;
  }

  let sent = 0;
  for (const followup of pending) {
    // One bad follow-up must not cost the person the reply to what they just wrote.
    try {
      const result = await sendMessengerReply({ pageId: args.pageId, psid: args.psid, body: followup.body });
      if (!result.ok) {
        // Left pending: it goes out with their next message, until it expires.
        console.warn(`[m4] follow-up ${followup.id} for ${label} not sent (${result.error})`);
        continue;
      }
      sent++;
      await markFollowupDelivered(followup.id).catch((error) =>
        console.error(`[m4] follow-up ${followup.id} was sent but not marked delivered (${reason(error)})`),
      );
      await insertMessage({ phoneHash: args.contactHash, role: 'assistant', body: followup.body }).catch(() => undefined);
      // site_id is left off: M3's voice call row already counts this referral for the ranking.
      await insertCall({
        direction: 'outbound',
        channel: 'messenger',
        phoneHash: args.contactHash,
        siteId: null,
        outcome: 'sms_sent',
      }).catch((error) => console.error(`[m4] follow-up ${followup.id}: calls row not written (${reason(error)})`));
    } catch (error) {
      console.error(`[m4] follow-up ${followup.id} for ${label} failed (${reason(error)})`);
    }
  }
  return sent;
}

// STOP: nothing held is sent after it.
export async function dropFollowups(contactHash: string): Promise<void> {
  await cancelFollowups(contactHash).catch((error) =>
    console.error(`[m4] follow-ups for ${messengerLogLabel(contactHash)} not dropped (${reason(error)})`),
  );
}
