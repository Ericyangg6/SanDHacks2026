import { getLatestReading, getSite, insertCall } from '../db';
import { hashPhone, maskPhone, toE164 } from '../phone';
import { isOptedOut } from '../subscribers/consent';
import { notImplemented } from '../todo';
import type { Language, SendSmsInput, SendSmsOutput } from '../types';
import { siteMessage } from './templates';
import { sendTwilioSms } from './twilio';

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

// The one guarded send path every outbound text goes through.
// It enforces opt-out only. Opt-in consent is the caller's job: the alert flow reads active subscribers,
// and a mid-call request counts as consent for that one text.
// It does not dedupe per alert (db.hasAlertText), bump alerts.texts_sent or write to messages.
export async function sendText(input: SendTextInput): Promise<SendSmsOutput> {
  // TODO: 1. Wrap every step below in try/catch. On a throw, log one line with maskPhone(to) and
  //          input.purpose, then return { ok: false, error }. Never throw to the caller, and keep the raw
  //          number out of logs and error strings.
  // TODO: 2. Normalize with toE164(input.to). null -> { ok: false, error: 'invalid_number' }.
  // TODO: 3. Reject an empty body, or one over Twilio's 1600 character limit -> { ok: false, error: 'invalid_body' }.
  // TODO: 4. if (await isOptedOut(to)) return { ok: false, error: 'opted_out' }. Fail closed: if the check
  //          itself throws, do not send.
  // TODO: 5. await sendTwilioSms({ to, body: input.body }).
  // TODO: 6. Log the calls row: insertCall({ direction: 'outbound', channel: 'sms', phoneHash: hashPhone(to),
  //          zip: input.zip ?? null, language: input.language ?? null, siteId: input.siteId ?? null,
  //          outcome: 'sms_sent', alertId: input.alertId ?? null }).
  //          If the insert fails after Twilio accepted the text, log it and still return { ok: true }, so the
  //          caller does not retry and text the person twice.
  // TODO: 7. Decide whether a failed send in step 5 also logs a calls row with outcome 'error'.
  // TODO: 8. return { ok: true }.
  return notImplemented('send-sms.sendText');
}

// The shared contract function. M3's voice agent calls this.
// Builds the site text from site_id and sends it through sendText. No subscriber row is needed, because
// a caller asking for a text mid-call is consent for that one message. An opted-out number is still refused.
export async function sendSms(input: SendSmsInput): Promise<SendSmsOutput> {
  // TODO: 1. Wrap in try/catch and return { ok: false, error } instead of throwing: M3 expects SendSmsOutput.
  // TODO: 2. const site = await getSite(input.site_id). null -> { ok: false, error: 'site_not_found' }.
  // TODO: 3. const reading = site.zip ? await getLatestReading(site.zip) : null. A failed reading lookup
  //          should not block the text: fall back to null.
  // TODO: 4. const language = input.language ?? 'en'.
  // TODO: 5. const body = siteMessage({ site, reading, language }).
  // TODO: 6. return sendText({ to: input.to, body, purpose: 'site', siteId: site.id, language }).
  //          zip stays unset: the dashboard reads calls.zip as demand by zip, SendSmsInput does not carry the
  //          caller's zip, and site.zip is not the same thing.
  // TODO: 7. Settle with M3 and M2 whether this row should carry site_id at all. M3 already logs the inbound
  //          voice call with the same site_id, so recent_referrals() in the ranking would count it twice.
  return notImplemented('send-sms.sendSms');
}
