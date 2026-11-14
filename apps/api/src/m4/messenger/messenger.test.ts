// Messenger integration tests. Nothing leaves the process: fetch is replaced, so no Neon or Twilio call is made.
//   npx tsx --test src/m4/messenger/messenger.test.ts      (from apps/api)

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { Hono } from 'hono';
import { m4ApiRoutes } from '../mastra/routes';
import { hashPhone } from '../phone';
import { sendTwilioMessenger, twilioSignature, validateTwilioSignature } from '../sms/twilio';
import { hashMessengerId, messengerLogLabel, parseMessengerAddress } from './identity';
import { handleInboundMessenger, parseMessengerWebhook } from './inbound';

// Made-up values. None of them is a real account, Page or person.
const PSID = '7712345678901234';
const PAGE_ID = '104455667788990';
const PUBLIC_BASE_URL = 'https://shade.example.test';

Object.assign(process.env, {
  PHONE_SALT: 'test-salt',
  TWILIO_ACCOUNT_SID: 'AC00000000000000000000000000000000',
  TWILIO_AUTH_TOKEN: 'test-auth-token',
  TWILIO_PHONE_NUMBER: '+16195550123',
  PUBLIC_BASE_URL,
  NEON_DATABASE_URL: 'postgres://user:pass@db.example.test/neondb',
});
delete process.env.M4_SMS_DRY_RUN;
delete process.env.TWILIO_SID;
delete process.env.TWILIO_SECRET;

type Sent = { url: string; form?: URLSearchParams; sql?: { query: string; params: unknown[] } };

let requests: Sent[] = [];
let logged: string[] = [];
let twilioResponse: () => Response;
const realFetch = globalThis.fetch;
const realConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error };

beforeEach(() => {
  requests = [];
  logged = [];
  twilioResponse = () => Response.json({ sid: 'SM00000000000000000000000000000001' }, { status: 201 });
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://api.twilio.com/')) {
      requests.push({ url, form: new URLSearchParams(String(init?.body)) });
      return twilioResponse();
    }
    if (url === 'https://db.example.test/sql') {
      requests.push({ url, sql: JSON.parse(String(init?.body)) });
      return Response.json({ rows: [{ id: 1 }] });
    }
    throw new Error(`unexpected fetch to ${url}`);
  }) as typeof fetch;
  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    console[level] = (...args: unknown[]) => void logged.push(args.map(String).join(' '));
  }
});

afterEach(() => {
  globalThis.fetch = realFetch;
  Object.assign(console, realConsole);
});

const twilioSends = () => requests.filter((r) => r.form);
const sqlCalls = () => requests.filter((r) => r.sql).map((r) => r.sql!);

function webhook(body: string, messageSid: string): Record<string, string> {
  return {
    MessageSid: messageSid,
    AccountSid: 'AC00000000000000000000000000000000',
    From: `messenger:${PSID}`,
    To: `messenger:${PAGE_ID}`,
    Body: body,
    NumMedia: '0',
  };
}

describe('Messenger identity', () => {
  it('parses messenger: addresses and refuses anything else', () => {
    assert.equal(parseMessengerAddress(`messenger:${PSID}`), PSID);
    assert.equal(parseMessengerAddress('+16195550100'), null);
    assert.equal(parseMessengerAddress('whatsapp:+16195550100'), null);
    assert.equal(parseMessengerAddress('messenger:'), null);
    assert.equal(parseMessengerAddress('messenger:12 34'), null);
  });

  it('hashes ids apart from phone numbers and never logs the raw id', () => {
    const hash = hashMessengerId(PSID);
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.equal(hash, hashMessengerId(PSID));
    assert.notEqual(hash, hashPhone(PSID));
    assert.notEqual(hash, hashPhone(`+${PSID}`));
    assert.ok(!messengerLogLabel(hash).includes(PSID));
  });
});

describe('Messenger webhook', () => {
  it('reads sender, Page, body and sid, without treating the sender as a phone number', () => {
    assert.deepEqual(parseMessengerWebhook(webhook('hi', 'SM1')), {
      psid: PSID,
      pageId: PAGE_ID,
      body: 'hi',
      messageSid: 'SM1',
    });
    // An SMS webhook pointed at the Messenger route.
    assert.equal(parseMessengerWebhook({ ...webhook('hi', 'SM1'), From: '+16195550100' }), null);
    assert.equal(parseMessengerWebhook({ ...webhook('hi', 'SM1'), MessageSid: '' }), null);
  });

  it('accepts the signature only for the exact public Messenger URL', () => {
    const params = webhook('hi', 'SM1');
    const url = `${PUBLIC_BASE_URL}/m4/twilio/messenger`;
    const signature = twilioSignature(url, params);
    assert.ok(validateTwilioSignature({ signature, url, params }));
    assert.ok(!validateTwilioSignature({ signature, url: `${PUBLIC_BASE_URL}/m4/twilio/sms`, params }));
    assert.ok(!validateTwilioSignature({ signature, url, params: { ...params, Body: 'changed' } }));
  });
});

describe('sendTwilioMessenger', () => {
  it('posts messenger: addresses to the Messages API', async () => {
    await sendTwilioMessenger({ pageId: PAGE_ID, psid: PSID, body: 'hello' });
    const [send] = twilioSends();
    assert.equal(send.url, 'https://api.twilio.com/2010-04-01/Accounts/AC00000000000000000000000000000000/Messages.json');
    assert.equal(send.form!.get('From'), `messenger:${PAGE_ID}`);
    assert.equal(send.form!.get('To'), `messenger:${PSID}`);
    assert.equal(send.form!.get('Body'), 'hello');
  });

  it('scrubs the Messenger id out of Twilio error messages', async () => {
    twilioResponse = () =>
      Response.json({ code: 63003, message: `Invalid To address messenger:${PSID}` }, { status: 400 });
    await assert.rejects(sendTwilioMessenger({ pageId: PAGE_ID, psid: PSID, body: 'hello' }), (error: Error) => {
      assert.ok(!error.message.includes(PSID));
      return true;
    });
  });
});

describe('handleInboundMessenger', () => {
  it('answers HELP from the Page, logs a hashed messenger calls row, and drops a repeat delivery', async () => {
    const msg = parseMessengerWebhook(webhook('HELP', 'SMtest-help'))!;
    const result = await handleInboundMessenger(msg);
    assert.deepEqual(result.sent, { ok: true });
    assert.match(result.reply!, /cooling center/);

    const [send] = twilioSends();
    assert.equal(send.form!.get('From'), `messenger:${PAGE_ID}`);
    assert.equal(send.form!.get('To'), `messenger:${PSID}`);
    assert.equal(send.form!.get('Body'), result.reply);

    const [call] = sqlCalls();
    assert.match(call.query, /insert into calls/);
    assert.deepEqual(call.params.slice(0, 3), ['inbound', 'messenger', hashMessengerId(PSID)]);

    // The raw id goes to Twilio and nowhere else: not to the database, not to the log.
    assert.ok(!JSON.stringify(sqlCalls()).includes(PSID));
    assert.ok(!logged.join('\n').includes(PSID));

    const repeat = await handleInboundMessenger(msg);
    assert.deepEqual(repeat, { reply: null, sent: null });
    assert.equal(twilioSends().length, 1);
  });

  it('points JOIN at SMS alerts without creating a subscriber', async () => {
    const result = await handleInboundMessenger(parseMessengerWebhook(webhook('JOIN 92105', 'SMtest-join'))!);
    assert.match(result.reply!, /\+16195550123/);
    assert.ok(sqlCalls().every((sql) => !/subscribers/.test(sql.query)));
  });

  it('answers a Spanish STOP in Spanish and records no opt-out', async () => {
    const result = await handleInboundMessenger(parseMessengerWebhook(webhook('ALTO', 'SMtest-stop'))!);
    assert.match(result.reply!, /de acuerdo/);
    assert.ok(sqlCalls().every((sql) => !/subscribers/.test(sql.query)));
  });

  it('reports a failed send without throwing or logging the id', async () => {
    twilioResponse = () => Response.json({ code: 63018, message: `Rate limit for messenger:${PSID}` }, { status: 429 });
    const result = await handleInboundMessenger(parseMessengerWebhook(webhook('HELP', 'SMtest-fail'))!);
    assert.deepEqual(result.sent, { ok: false, error: 'twilio_63018' });
    assert.ok(!logged.join('\n').includes(PSID));
  });
});

// The real M4 routes in a bare Hono app, with a stand-in for the Mastra instance the handlers read their logger from.
function app(): Hono {
  const server = new Hono();
  server.use(async (c, next) => {
    c.set('mastra' as never, { getLogger: () => undefined } as never);
    await next();
  });
  for (const route of m4ApiRoutes) {
    if ('path' in route && 'handler' in route && route.method === 'POST') {
      server.post(route.path, route.handler as never);
    }
  }
  return server;
}

async function post(path: string, params: Record<string, string>, signature: string | null): Promise<Response> {
  return app().request(`http://localhost:4111${path}`, {
    method: 'POST',
    headers: signature ? { 'X-Twilio-Signature': signature } : {},
    body: new URLSearchParams(params),
  });
}

// The Messenger route sends after it has answered, so wait for the send to land.
async function settle(): Promise<void> {
  for (let i = 0; i < 200 && twilioSends().length === 0; i++) await new Promise((r) => setTimeout(r, 5));
}

describe('POST /m4/twilio/messenger', () => {
  const path = '/m4/twilio/messenger';
  const sign = (params: Record<string, string>, p = path) => twilioSignature(PUBLIC_BASE_URL + p, params);

  it('acks with an empty <Response/> and sends the reply over Messenger', async () => {
    const params = webhook('HELP', 'SMroute-ok');
    const response = await post(path, params, sign(params));
    assert.equal(response.status, 200);
    assert.match(await response.text(), /<Response\/>$/);
    await settle();
    const [send] = twilioSends();
    assert.equal(send.form!.get('From'), `messenger:${PAGE_ID}`);
    assert.equal(send.form!.get('To'), `messenger:${PSID}`);
  });

  it('refuses a missing signature, or one made for the SMS URL', async () => {
    const params = webhook('HELP', 'SMroute-forbidden');
    assert.equal((await post(path, params, null)).status, 403);
    assert.equal((await post(path, params, sign(params, '/m4/twilio/sms'))).status, 403);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(requests.length, 0);
  });

  it('refuses a signed webhook whose sender is a phone number', async () => {
    const params = { ...webhook('HELP', 'SMroute-sms'), From: '+16195550100', To: '+16195550123' };
    assert.equal((await post(path, params, sign(params))).status, 400);
    assert.equal(requests.length, 0);
  });
});

describe('POST /m4/twilio/sms (unchanged)', () => {
  it('still answers a signed SMS with TwiML and an sms calls row', async () => {
    const params = { MessageSid: 'SMroute-sms-help', From: '+16195550100', To: '+16195550123', Body: 'HELP' };
    const signature = twilioSignature(`${PUBLIC_BASE_URL}/m4/twilio/sms`, params);
    const response = await post('/m4/twilio/sms', params, signature);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /<Message>Shade: heat and smoke alerts/);
    assert.equal(twilioSends().length, 0);
    const insert = sqlCalls().find((sql) => /insert into calls/.test(sql.query))!;
    assert.deepEqual(insert.params.slice(0, 3), ['inbound', 'sms', hashPhone('+16195550100')]);
  });
});
