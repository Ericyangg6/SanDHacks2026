import { getLatestReading, getMessengerProfileByPhone, getSite, insertCall, setOptedOut } from '../db';
import { env } from '../env';
import { queueFollowup } from '../messenger/followups';
import { hashPhone, maskPhone, toE164 } from '../phone';
import { isOptedOut } from '../subscribers/consent';
import type { AlertChannel, Language, MessengerContact, Reading, SendSmsInput, SendSmsOutput } from '../types';
import { siteMessage } from './templates';
import { sendTwilioSms, sendTwilioWhatsApp, TwilioError, type WhatsAppTemplate } from './twilio';

// 'site': one site's details (send_sms). 'alert': alert fan-out. 'reply': text agent answer.
// 'system': opt-in, opt-out and help confirmations. calls has no column for it, so it only shapes log lines.
export type TextPurpose = 'site' | 'alert' | 'reply' | 'system';

export interface SendTextInput {
  to: string; // E.164
  body: string;
  purpose: TextPurpose;
  channel?: AlertChannel; // default 'sms'
  // WhatsApp only: an approved template, for a message more than 24 hours after the person last wrote. body is
  // then only used for logs; the template's text is what is delivered.
  template?: WhatsAppTemplate;
  alertId?: number;
  siteId?: number;
  zip?: string;
  language?: Language;
}

// Twilio rejects a longer body outright.
const MAX_BODY_LENGTH = 1600;
// Twilio's code for "this number replied STOP to Twilio itself".
const TWILIO_RECIPIENT_OPTED_OUT = 21610;

function reason(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

// The one guarded send path every outbound text goes through. It never throws: a failure comes back as
// { ok: false, error }, with one of invalid_number, invalid_body, opted_out, opt_out_check_failed,
// twilio_<code> or send_failed.
// It enforces opt-out only. Opt-in consent is the caller's job: the alert flow reads active subscribers,
// and a mid-call request counts as consent for that one text.
// It does not dedupe per alert (db.hasAlertText), bump alerts.texts_sent or write to messages.
// Only a text that was sent gets a calls row. A failed send is logged to the console and nowhere else.
export async function sendText(input: SendTextInput): Promise<SendSmsOutput> {
  const to = toE164(input.to);
  if (!to) return { ok: false, error: 'invalid_number' };
  if (!input.body.trim() || input.body.length > MAX_BODY_LENGTH) return { ok: false, error: 'invalid_body' };
  const channel: AlertChannel = input.channel === 'whatsapp' ? 'whatsapp' : 'sms';
  const label = `${input.purpose} ${channel === 'whatsapp' ? 'WhatsApp message' : 'text'} to ${maskPhone(to)}`;

  // Fail closed: with no answer on opt-out, nothing is sent.
  try {
    if (await isOptedOut(to)) return { ok: false, error: 'opted_out' };
  } catch (error) {
    console.warn(`[m4] ${label} not sent: the opt-out check failed (${reason(error)})`);
    return { ok: false, error: 'opt_out_check_failed' };
  }

  try {
    if (channel === 'whatsapp') await sendTwilioWhatsApp({ to, body: input.body, template: input.template });
    else await sendTwilioSms({ to, body: input.body });
  } catch (error) {
    console.warn(`[m4] ${label} not sent: ${reason(error)}`);
    const code = error instanceof TwilioError ? error.code : null;
    // Twilio keeps its own opt-out list. Copy a STOP it knows about, so we stop trying this number.
    if (code === TWILIO_RECIPIENT_OPTED_OUT) {
      await setOptedOut(hashPhone(to), new Date()).catch(() => undefined);
    }
    return { ok: false, error: code ? `twilio_${code}` : 'send_failed' };
  }

  // The text is out. If the log row fails, still report success so the caller does not send it again.
  try {
    await insertCall({
      direction: 'outbound',
      channel,
      phoneHash: hashPhone(to),
      zip: input.zip ?? null,
      language: input.language ?? null,
      siteId: input.siteId ?? null,
      outcome: 'sms_sent',
      alertId: input.alertId ?? null,
    });
  } catch (error) {
    console.error(`[m4] ${label} was sent but its calls row was not written (${reason(error)})`);
  }
  return { ok: true };
}

// What the voice agent tells the caller (SendSmsOutput.note). Instructions to the voice model, which speaks the
// caller's language, so they stay in English.
const NOTE_HELD_FOR_MESSENGER =
  "Saved for the caller's Messenger. Tell them the address, hours and map link will arrive in Facebook Messenger " +
  'the next time they send any message to the Shadoes Facebook Page. Offer to read the address out now too.';
const NOTE_NO_MESSENGER =
  'Not sent: Shade cannot send text messages right now. Read the address out so the caller can write it down. Tell ' +
  'them that to get addresses on Facebook Messenger next time, they can message the Shadoes Facebook Page "JOIN", ' +
  'their zip code and this phone number, for example "JOIN 92105 6195551234".';

// The shared contract function. M3's voice agent calls this when a caller asks to be texted a site.
// Builds the site text from site_id. Messenger first: when the caller's number is linked to a Messenger profile
// (JOIN <zip> <phone>), the text is held and sent the next time they message the Page (messenger/followups.ts).
// Otherwise nothing is sent, unless M4_SMS_ENABLED=1, when it goes out by SMS through sendText.
// No subscriber row is needed: a caller asking for a text mid-call is consent for that one message. An opted-out
// number is still refused. Never throws. Errors on top of sendText's: site_not_found, lookup_failed,
// no_messenger_profile, followup_failed. `note` tells the voice agent what to say about delivery.
export async function sendSms(input: SendSmsInput): Promise<SendSmsOutput> {
  const language = input.language ?? 'en';
  const to = toE164(input.to);
  if (!to) return { ok: false, error: 'invalid_number' };

  let body: string;
  let siteId: number;
  try {
    const site = await getSite(input.site_id);
    if (!site) return { ok: false, error: 'site_not_found' };
    // A missing air quality reading must not hold the text back.
    const reading: Reading | null = site.zip ? await getLatestReading(site.zip).catch(() => null) : null;
    body = siteMessage({ site, reading, language });
    siteId = site.id;
  } catch (error) {
    console.warn(`[m4] send_sms for site ${input.site_id} failed before sending (${reason(error)})`);
    return { ok: false, error: 'lookup_failed' };
  }

  // Fail closed, as sendText does: with no answer on opt-out, nothing is held or sent.
  let profile: MessengerContact | null;
  try {
    if (await isOptedOut(to)) return { ok: false, error: 'opted_out' };
    profile = await getMessengerProfileByPhone(hashPhone(to));
  } catch (error) {
    console.warn(`[m4] send_sms to ${maskPhone(to)} not handled: a lookup failed (${reason(error)})`);
    return { ok: false, error: 'lookup_failed' };
  }

  if (profile) {
    try {
      await queueFollowup({ profile, body, siteId, language });
      return { ok: true, note: NOTE_HELD_FOR_MESSENGER };
    } catch (error) {
      console.warn(`[m4] send_sms to ${maskPhone(to)}: follow-up not saved (${reason(error)})`);
      return { ok: false, error: 'followup_failed', note: NOTE_NO_MESSENGER };
    }
  }
  if (!env.smsEnabled()) return { ok: false, error: 'no_messenger_profile', note: NOTE_NO_MESSENGER };

  // zip stays unset: the dashboard reads calls.zip as demand by zip, SendSmsInput does not carry the caller's
  // zip, and site.zip is not the same thing.
  // TODO: Settle with M3 and M2 whether this row should carry site_id at all. M3 already logs the inbound
  //       voice call with the same site_id, so recent_referrals() in the ranking would count it twice.
  return sendText({ to, body, purpose: 'site', siteId, language });
}
