import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../env';
import { notImplemented } from '../todo';

// Thin Twilio REST client built on fetch (the `twilio` package is not installed).
// Nothing here checks consent or logs: call sendText in ./send-sms instead of sendTwilioSms directly.

// Sends one SMS from TWILIO_PHONE_NUMBER and returns Twilio's message sid. Throws on any failure.
export async function sendTwilioSms(args: { to: string; body: string }): Promise<{ sid: string }> {
  // TODO: 1. Read { accountSid, apiKeySid, apiKeySecret, phoneNumber } from env.twilio().
  // TODO: 2. POST https://api.twilio.com/2010-04-01/Accounts/{accountSid}/Messages.json with a
  //          form-encoded body (URLSearchParams: To, From, Body) and the header
  //          Authorization: Basic base64(`${apiKeySid}:${apiKeySecret}`). Add a timeout (AbortSignal.timeout).
  // TODO: 3. On a non-2xx response, throw an Error carrying Twilio's `code` and `message` from the JSON body.
  //          Code 21610 means the number replied STOP to Twilio itself. Keep `args.to` out of the error text.
  // TODO: 4. Return { sid } from the JSON response.
  return notImplemented('twilio.sendTwilioSms');
}

// Checks the X-Twilio-Signature header of an inbound webhook: base64(HMAC-SHA1(auth token, url + sorted params)).
// `url` must be the exact public URL Twilio requested (env.publicBaseUrl() + path + query string), not the
// local one behind the tunnel. `params` are the form-encoded POST fields. Throws if the auth token is unset.
export function validateTwilioSignature(args: {
  signature: string;
  url: string;
  params: Record<string, string>;
}): boolean {
  const authToken = env.twilioAuthToken();
  const data = Object.keys(args.params)
    .sort()
    .reduce((acc, key) => acc + key + args.params[key], args.url);
  const expected = Buffer.from(createHmac('sha1', authToken).update(data, 'utf8').digest('base64'));
  const given = Buffer.from(args.signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
