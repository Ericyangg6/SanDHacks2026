import { getLatestReading, getSite, insertCall, setOptedOut } from '../db';
import { hashPhone, maskPhone, toE164 } from '../phone';
import { isOptedOut } from '../subscribers/consent';
import type { Language, Reading, SendSmsInput, SendSmsOutput } from '../types';
import { siteMessage } from './templates';
import { sendTwilioSms, TwilioError } from './twilio';

// 'site': one site's details (send_sms). 'alert': alert fan-out. 'reply': text agent answer.
// 'system': opt-in, opt-out and help confirmations. calls has no column for it, so it only shapes log lines.
export type TextPurpose = 'site' | 'alert' | 'reply' | 'system';

export interface SendTextInput {
  to: string; // E.164
  body: string;
  purpose: TextPurpose;
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
  const label = `${input.purpose} text to ${maskPhone(to)}`;

  // Fail closed: with no answer on opt-out, nothing is sent.
  try {
    if (await isOptedOut(to)) return { ok: false, error: 'opted_out' };
  } catch (error) {
    console.warn(`[m4] ${label} not sent: the opt-out check failed (${reason(error)})`);
    return { ok: false, error: 'opt_out_check_failed' };
  }

  try {
    await sendTwilioSms({ to, body: input.body });
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
      channel: 'sms',
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

// The shared contract function. M3's voice agent calls this.
// Builds the site text from site_id and sends it through sendText. No subscriber row is needed, because
// a caller asking for a text mid-call is consent for that one message. An opted-out number is still refused.
// Never throws. On top of sendText's errors it can return site_not_found and lookup_failed.
export async function sendSms(input: SendSmsInput): Promise<SendSmsOutput> {
  const language = input.language ?? 'en';

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

  // zip stays unset: the dashboard reads calls.zip as demand by zip, SendSmsInput does not carry the caller's
  // zip, and site.zip is not the same thing.
  // TODO: Settle with M3 and M2 whether this row should carry site_id at all. M3 already logs the inbound
  //       voice call with the same site_id, so recent_referrals() in the ranking would count it twice.
  return sendText({ to: input.to, body, purpose: 'site', siteId, language });
}
