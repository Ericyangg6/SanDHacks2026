import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { env } from '../env';
import { hashMessengerId, messengerAddress, messengerLogLabel } from '../messenger/identity';
import { maskPhone } from '../phone';

// Thin Twilio REST client built on fetch (the `twilio` package is not installed).
// Nothing here checks consent or logs: call sendText in ./send-sms instead of sendTwilioSms directly.

const TWILIO_TIMEOUT_MS = 10_000;

// Any failed send. `code` is Twilio's own error code when the API returned one, e.g. 21610 when the number
// replied STOP to Twilio itself. The message never contains a phone number.
export class TwilioError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: number | null,
  ) {
    super(message);
    this.name = 'TwilioError';
  }
}

// Twilio's error text often quotes the number or Messenger id it refused. Messenger ids run past 15 digits.
function scrubNumbers(text: string): string {
  return text.replace(/(?:messenger:)?\+?\d{7,}/g, '[number]');
}

function dryRunSid(): string {
  return `DRYRUN${randomUUID().replace(/-/g, '')}`;
}

// Sends one SMS from TWILIO_PHONE_NUMBER and returns Twilio's message sid. Throws TwilioError on any failure.
// With M4_SMS_DRY_RUN=1 nothing is sent: the text is logged with a masked number and a made-up sid comes back.
export async function sendTwilioSms(args: { to: string; body: string }): Promise<{ sid: string }> {
  if (env.smsDryRun()) {
    console.info(`[m4] dry run, not sent. To ${maskPhone(args.to)}:\n${args.body}`);
    return { sid: dryRunSid() };
  }
  const { phoneNumber } = env.twilio();
  return createMessage({ To: args.to, From: phoneNumber, Body: args.body });
}

// Sends one Facebook Messenger message from the Page `pageId` to the person `psid` (bare ids, no 'messenger:'
// prefix) and returns Twilio's message sid. Throws TwilioError on any failure. M4_SMS_DRY_RUN=1 covers this too.
// Messenger allows a reply for 24 hours after the person's last message. Twilio tags a later one ACCOUNT_UPDATE,
// which alerts and other promotional messages may not use, so only call this to answer a message just received.
// Nothing here checks consent or logs: call sendMessengerReply in ../messenger/send instead.
export async function sendTwilioMessenger(args: { pageId: string; psid: string; body: string }): Promise<{ sid: string }> {
  if (env.smsDryRun()) {
    console.info(`[m4] dry run, not sent. To ${messengerLogLabel(hashMessengerId(args.psid))}:\n${args.body}`);
    return { sid: dryRunSid() };
  }
  return createMessage({ To: messengerAddress(args.psid), From: messengerAddress(args.pageId), Body: args.body });
}

// POST to the Messages API, shared by SMS and Messenger: the channel is in the To and From addresses.
async function createMessage(params: { To: string; From: string; Body: string }): Promise<{ sid: string }> {
  const { accountSid, username, password } = env.twilioCredentials();
  let response: Response;
  try {
    response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(TWILIO_TIMEOUT_MS),
    });
  } catch (error) {
    // Network failure or timeout. Twilio may or may not have accepted the text.
    const reason = error instanceof Error ? error.name : 'unknown error';
    throw new TwilioError(`Twilio request failed: ${reason}`, null, null);
  }

  const payload = (await response.json().catch(() => null)) as {
    sid?: unknown;
    code?: unknown;
    message?: unknown;
  } | null;

  if (!response.ok) {
    const message = typeof payload?.message === 'string' ? payload.message : `HTTP ${response.status}`;
    const code = typeof payload?.code === 'number' ? payload.code : null;
    throw new TwilioError(scrubNumbers(message), response.status, code);
  }
  if (typeof payload?.sid !== 'string') {
    throw new TwilioError('Twilio accepted the request but returned no message sid', response.status, null);
  }
  return { sid: payload.sid };
}

// The X-Twilio-Signature value for a webhook: base64(HMAC-SHA1(auth token, url + sorted params)).
// Throws if the auth token is unset.
export function twilioSignature(url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac('sha1', env.twilioAuthToken()).update(data, 'utf8').digest('base64');
}

// Checks the X-Twilio-Signature header of an inbound webhook.
// `url` must be the exact public URL Twilio requested (env.publicBaseUrl() + path + query string), not the
// local one behind the tunnel. `params` are the form-encoded POST fields. Throws if the auth token is unset.
export function validateTwilioSignature(args: {
  signature: string;
  url: string;
  params: Record<string, string>;
}): boolean {
  const expected = Buffer.from(twilioSignature(args.url, args.params));
  const given = Buffer.from(args.signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
