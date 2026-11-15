import { generateTextReply } from '../agent/reply';
import { getSubscriber, insertCall } from '../db';
import {
  messengerHelpMessage,
  messengerJoinUsage,
  messengerOptInConfirmation,
  messengerStopConfirmation,
  replyUnavailable,
} from '../sms/templates';
import { detectKeyword, optOutMessenger, subscribeMessenger, type KeywordMatch } from '../subscribers/consent';
import type { CallOutcome, Language, SendSmsOutput } from '../types';
import { hashMessengerId, messengerLogLabel, parseMessengerAddress } from './identity';
import { sendMessengerReply } from './send';

export interface InboundMessenger {
  psid: string; // the person's page-scoped id: inbound From, minus 'messenger:'
  pageId: string; // the Facebook Page written to: inbound To, minus 'messenger:'. The reply goes out from it
  body: string;
  messageSid: string;
}

export interface MessengerResult {
  reply: string | null; // null = nothing sent
  sent: SendSmsOutput | null;
}

// Twilio can deliver one message twice. As for SMS, recent MessageSids are remembered in this process only, and
// a repeat is dropped: the first delivery already sent the reply.
const DEDUPE_TTL_MS = 10 * 60_000;
const recent = new Map<string, number>();

// Pure. Reads Twilio's inbound-message form fields for a Messenger message: From is `messenger:<psid>`, To is
// `messenger:<page id>`, plus Body and MessageSid. Null when a field is missing or From / To is not a Messenger
// address, for example an SMS webhook pointed at the Messenger route.
export function parseMessengerWebhook(params: Record<string, string>): InboundMessenger | null {
  const psid = parseMessengerAddress(params.From ?? '');
  const pageId = parseMessengerAddress(params.To ?? '');
  const messageSid = params.MessageSid ?? '';
  if (!psid || !pageId || !messageSid) return null;
  return { psid, pageId, body: params.Body ?? '', messageSid };
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

// Handles one inbound Messenger message and sends the reply itself, through the Messages API. The webhook has
// already answered Twilio by then, so a slow agent turn cannot hit Twilio's 15-second limit.
// Messenger is Shade's main channel, with the same keywords as SMS: JOIN <zip> and START sign the person up for
// alerts here (subscribers row keyed by the Messenger hash, alert_channel 'messenger'), STOP opts them out, HELP
// explains. Anything else goes to the text agent, keyed by the Messenger hash.
// Logs one calls row (inbound, messenger), which also opens Messenger's 24-hour window for alerts. Never throws.
export async function handleInboundMessenger(msg: InboundMessenger): Promise<MessengerResult> {
  const now = Date.now();
  for (const [sid, at] of recent) {
    if (now - at > DEDUPE_TTL_MS) recent.delete(sid);
  }
  if (recent.has(msg.messageSid)) return { reply: null, sent: null };
  recent.set(msg.messageSid, now);

  const match = detectKeyword(msg.body);
  let reply: string;
  let label = 'messenger:unknown';
  try {
    const contactHash = hashMessengerId(msg.psid);
    label = messengerLogLabel(contactHash);
    reply = await answer(msg, contactHash, label, match);
  } catch (error) {
    console.error(`[m4] inbound Messenger message from ${label} failed (${reason(error)})`);
    // The language is not known unless a keyword gave it away, so the reply carries both.
    reply = match?.language === 'es' ? replyUnavailable('es') : `${replyUnavailable('en')}\n\n${replyUnavailable('es')}`;
  }

  const sent = await sendMessengerReply({ pageId: msg.pageId, psid: msg.psid, body: reply });
  return { reply, sent };
}

async function answer(
  msg: InboundMessenger,
  contactHash: string,
  label: string,
  match: KeywordMatch | null,
): Promise<string> {
  const subscriber = await getSubscriber(contactHash);
  // A Spanish keyword is answered in Spanish. Otherwise the subscriber's language, else English.
  let language: Language = match?.language === 'es' ? 'es' : (subscriber?.language ?? 'en');
  let zip = subscriber?.zip ?? null;
  // call_outcome has no value for a keyword exchange, so those rows keep a null outcome.
  let outcome: CallOutcome | null = null;
  let siteId: number | null = null;
  let reply: string;

  switch (match?.keyword) {
    case 'stop':
      await optOutMessenger(contactHash);
      reply = messengerStopConfirmation(language);
      break;

    case 'start':
    case 'join': {
      const typedZip = match.keyword === 'join' ? /\b\d{5}\b/.exec(msg.body)?.[0] : undefined;
      const newZip = typedZip ?? subscriber?.zip;
      if (!newZip) {
        reply = messengerJoinUsage(language);
        break;
      }
      const row = await subscribeMessenger({
        contactHash,
        psid: msg.psid,
        pageId: msg.pageId,
        zip: newZip,
        language: match.language === 'es' ? 'es' : undefined,
      });
      language = row.language;
      zip = row.zip;
      reply = messengerOptInConfirmation(language, row.zip);
      break;
    }

    case 'help':
      reply = messengerHelpMessage(language);
      break;

    default:
      if (!msg.body.trim()) {
        // A sticker or a picture with no words, for example.
        reply = messengerHelpMessage(language);
      } else {
        // Answered even after STOP: STOP cancels alerts, and this person just wrote to us.
        try {
          const turn = await generateTextReply({ contactHash, body: msg.body, channel: 'messenger', logLabel: label });
          reply = turn.text;
          outcome = turn.outcome;
          siteId = turn.siteId;
          language = turn.language;
        } catch (error) {
          console.error(`[m4] text agent failed for ${label} (${reason(error)})`);
          reply = replyUnavailable(language);
          outcome = 'error';
        }
      }
  }

  // The reply matters more than the log row.
  await insertCall({ direction: 'inbound', channel: 'messenger', phoneHash: contactHash, zip, language, siteId, outcome }).catch(
    (error) => console.error(`[m4] inbound Messenger message from ${label}: calls row not written (${reason(error)})`),
  );
  return reply;
}
