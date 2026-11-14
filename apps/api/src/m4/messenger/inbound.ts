import { generateTextReply } from '../agent/reply';
import { insertCall } from '../db';
import { messengerHelpMessage, messengerJoinInfo, messengerStopConfirmation, replyUnavailable } from '../sms/templates';
import { detectKeyword, type KeywordMatch } from '../subscribers/consent';
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

// TWILIO_PHONE_NUMBER, quoted in replies that point people at SMS alerts.
function smsNumber(): string | null {
  return process.env.TWILIO_PHONE_NUMBER || null;
}

// Handles one inbound Messenger message and sends the reply itself, through the Messages API. The webhook has
// already answered Twilio by then, so a slow agent turn cannot hit Twilio's 15-second limit.
// STOP / START / HELP / JOIN get fixed Messenger replies. Nobody is subscribed or unsubscribed: alerts need a
// phone number and go out by SMS only. Anything else goes to the text agent, keyed by the Messenger hash.
// Logs one calls row (inbound, messenger). Never throws.
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
    reply = await answer(contactHash, label, msg.body, match);
  } catch (error) {
    console.error(`[m4] inbound Messenger message from ${label} failed (${reason(error)})`);
    // The language is not known unless a keyword gave it away, so the reply carries both.
    reply = match?.language === 'es' ? replyUnavailable('es') : `${replyUnavailable('en')}\n\n${replyUnavailable('es')}`;
  }

  const sent = await sendMessengerReply({ pageId: msg.pageId, psid: msg.psid, body: reply });
  return { reply, sent };
}

async function answer(contactHash: string, label: string, body: string, match: KeywordMatch | null): Promise<string> {
  // No subscriber row exists for a Messenger hash, so only a Spanish keyword says anything about language.
  let language: Language = match?.language === 'es' ? 'es' : 'en';
  // call_outcome has no value for a keyword exchange, so those rows keep a null outcome.
  let outcome: CallOutcome | null = null;
  let siteId: number | null = null;
  let reply: string;

  switch (match?.keyword) {
    case 'stop':
      reply = messengerStopConfirmation(language);
      break;
    case 'start':
    case 'join':
      reply = messengerJoinInfo(language, smsNumber());
      break;
    case 'help':
      reply = messengerHelpMessage(language, smsNumber());
      break;
    default:
      if (!body.trim()) {
        // A sticker or a picture with no words, for example.
        reply = messengerHelpMessage(language, smsNumber());
      } else {
        try {
          const turn = await generateTextReply({ contactHash, body, channel: 'messenger', logLabel: label });
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

  // The reply matters more than the log row. Until the database has the 'messenger' channel value
  // (alter type channel add value 'messenger'), this insert fails and only the log line below is left.
  await insertCall({ direction: 'inbound', channel: 'messenger', phoneHash: contactHash, language, siteId, outcome }).catch(
    (error) => console.error(`[m4] inbound Messenger message from ${label}: calls row not written (${reason(error)})`),
  );
  return reply;
}
