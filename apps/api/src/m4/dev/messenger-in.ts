// Stands in for someone writing to the Facebook Page on Messenger: posts a correctly signed inbound Messenger
// webhook to the local dev server.
//   node src/m4/dev/run.mjs messenger-in "where can I cool off near 92105?" [--psid 1000000000000001] [--page <id>]
// The route answers Twilio with an empty <Response/> and sends the reply on its own, so the reply shows up in the
// dev server's log, not here. Start the server with M4_SMS_DRY_RUN=1 so nothing goes to Twilio: the default ids
// are made up, and a real send to them would fail. The calls and messages rows it writes are real; see the README.
// Needs TWILIO_AUTH_TOKEN, PHONE_SALT and the same PUBLIC_BASE_URL the dev server has.
// M4_SERVER_URL overrides where the request goes (default http://localhost:4111).

import { randomUUID } from 'node:crypto';
import { env } from '../env';
import { hashMessengerId, messengerAddress, messengerLogLabel, parseMessengerAddress } from '../messenger/identity';
import { twilioSignature } from '../sms/twilio';

const PATH = '/m4/twilio/messenger';

const args = process.argv.slice(3);
function option(name: string, fallback: string): string {
  const index = args.indexOf(name);
  return index >= 0 ? (args.splice(index, 2)[1] ?? fallback) : fallback;
}
const psid = option('--psid', '1000000000000001');
const pageId = option('--page', process.env.TWILIO_MESSENGER_PAGE_ID || '100000000000002');
if (!parseMessengerAddress(messengerAddress(psid))) throw new Error('--psid must be a numeric Messenger id');
if (!parseMessengerAddress(messengerAddress(pageId))) throw new Error('--page must be a numeric Page id');
const body = args.join(' ');

// The fields Twilio posts for a Messenger message, minus the ones the route does not read.
const params: Record<string, string> = {
  MessageSid: `SM${randomUUID().replace(/-/g, '')}`,
  AccountSid: process.env.TWILIO_ACCOUNT_SID ?? 'AC00000000000000000000000000000000',
  From: messengerAddress(psid),
  To: messengerAddress(pageId),
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

const label = messengerLogLabel(hashMessengerId(psid));
console.log(`${label} wrote: ${JSON.stringify(body)}`);
if (!response.ok) {
  console.log(`HTTP ${response.status} after ${ms} ms: ${text.slice(0, 200)}`);
  process.exitCode = 1;
} else {
  console.log(`Accepted (HTTP ${response.status}, ${ms} ms). The reply to ${label} is in the dev server's log.`);
}
