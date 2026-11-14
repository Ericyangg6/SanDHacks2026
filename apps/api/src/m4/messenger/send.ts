import { sendTwilioMessenger, TwilioError } from '../sms/twilio';
import type { SendSmsOutput } from '../types';
import { hashMessengerId, messengerLogLabel } from './identity';

// Twilio rejects a longer body outright. Messenger's own limit (2,000) is higher.
const MAX_BODY_LENGTH = 1600;

function reason(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

// Answers one inbound Messenger message. pageId and psid are bare ids: the inbound To and From, minus
// 'messenger:'. Never throws: a failure comes back as { ok: false, error }, with one of invalid_body,
// twilio_<code> or send_failed.
// Replies only. Messenger allows a message for 24 hours after the person last wrote, and Shade never starts a
// Messenger conversation, so there is no consent or opt-out state to check: every send answers a message that
// just arrived. Alerts stay on SMS (sendText).
// No calls row is written for the reply, as with SMS replies: the inbound row already records the exchange.
export async function sendMessengerReply(args: { pageId: string; psid: string; body: string }): Promise<SendSmsOutput> {
  if (!args.body.trim() || args.body.length > MAX_BODY_LENGTH) return { ok: false, error: 'invalid_body' };
  try {
    await sendTwilioMessenger(args);
    return { ok: true };
  } catch (error) {
    console.warn(`[m4] reply to ${messengerLogLabel(hashMessengerId(args.psid))} not sent: ${reason(error)}`);
    const code = error instanceof TwilioError ? error.code : null;
    return { ok: false, error: code ? `twilio_${code}` : 'send_failed' };
  }
}
