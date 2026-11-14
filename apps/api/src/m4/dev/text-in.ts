// Stands in for a phone texting the Twilio number: posts a correctly signed inbound-SMS webhook to the local dev
// server and prints the reply Twilio would have texted back.
//   node src/m4/dev/run.mjs text-in "JOIN 92105" [--from +16195550100] [--whatsapp]
// --whatsapp posts to the WhatsApp webhook instead, with whatsapp:-prefixed From and To.
// The default sender is a fictional 555 number, so the subscriber row it creates holds no real number. Delete the
// rows afterwards (see the README). Needs TWILIO_AUTH_TOKEN, and the same PUBLIC_BASE_URL the dev server has.
// M4_SERVER_URL overrides where the request goes (default http://localhost:4111).

import { randomUUID } from 'node:crypto';
import { env } from '../env';
import { maskPhone, toE164, whatsAppAddress } from '../phone';
import { twilioSignature } from '../sms/twilio';

const args = process.argv.slice(3);
const whatsAppIndex = args.indexOf('--whatsapp');
const whatsApp = whatsAppIndex >= 0;
if (whatsApp) args.splice(whatsAppIndex, 1);
const PATH = whatsApp ? '/m4/twilio/whatsapp' : '/m4/twilio/sms';
const address = (e164: string) => (whatsApp ? whatsAppAddress(e164) : e164);

const fromIndex = args.indexOf('--from');
const fromArg = fromIndex >= 0 ? args.splice(fromIndex, 2)[1] : '+16195550100';
const from = toE164(fromArg ?? '');
if (!from) throw new Error('--from is not a valid phone number');
const body = args.join(' ');

// The same fields Twilio posts, minus the ones the route does not read.
const params: Record<string, string> = {
  MessageSid: `SM${randomUUID().replace(/-/g, '')}`,
  AccountSid: process.env.TWILIO_ACCOUNT_SID ?? 'AC00000000000000000000000000000000',
  From: address(from),
  To: address(process.env.TWILIO_PHONE_NUMBER ?? '+15005550006'),
  Body: body,
  NumMedia: '0',
};

// Signed against the public URL, as Twilio does, but sent straight to the local server.
const signature = twilioSignature(env.publicBaseUrl().replace(/\/+$/, '') + PATH, params);
const target = (process.env.M4_SERVER_URL || 'http://localhost:4111').replace(/\/+$/, '') + PATH;

const started = Date.now();
const response = await fetch(target, {
  method: 'POST',
  headers: { 'X-Twilio-Signature': signature },
  body: new URLSearchParams(params),
});
const text = await response.text();
const ms = Date.now() - started;

const message = /<Message>([\s\S]*?)<\/Message>/.exec(text)?.[1];
const reply = message
  ?.replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&amp;/g, '&');

console.log(`${maskPhone(from)} ${whatsApp ? 'wrote on WhatsApp' : 'texted'}: ${JSON.stringify(body)}`);
if (!response.ok) {
  console.log(`HTTP ${response.status} after ${ms} ms: ${text.slice(0, 200)}`);
  process.exitCode = 1;
} else {
  console.log(reply === undefined ? `No reply (${ms} ms).` : `Reply (${ms} ms):\n${reply}`);
}
