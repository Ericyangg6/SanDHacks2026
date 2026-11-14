// WhatsApp tests. Nothing leaves the process: fetch is replaced by a fake Neon endpoint and a fake Twilio.
//   npx tsx --test src/m4/whatsapp.test.ts      (from apps/api)

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { Hono } from 'hono';
import { dispatchAlert } from './alerts/dispatch';
import { m4ApiRoutes } from './mastra/routes';
import { fromWhatsAppAddress, hashPhone } from './phone';
import { sendText } from './sms/send-sms';
import { twilioSignature } from './sms/twilio';
import type { AlertRow, SubscriberRow } from './types';

// Made-up values. None of them is a real account or person.
const PERSON = '+16195550142';
const SENDER = '+16195550123';
const PUBLIC_BASE_URL = 'https://shade.example.test';

Object.assign(process.env, {
  PHONE_SALT: 'test-salt',
  TWILIO_ACCOUNT_SID: 'AC00000000000000000000000000000000',
  TWILIO_AUTH_TOKEN: 'test-auth-token',
  TWILIO_PHONE_NUMBER: SENDER,
  PUBLIC_BASE_URL,
  NEON_DATABASE_URL: 'postgres://user:pass@db.example.test/neondb',
});
for (const name of ['M4_SMS_DRY_RUN', 'TWILIO_SID', 'TWILIO_SECRET', 'TWILIO_WHATSAPP_FROM']) delete process.env[name];

// ---- fake database and Twilio ----

interface Db {
  subscriber: SubscriberRow | null; // what getSubscriber returns
  active: SubscriberRow[]; // what listActiveSubscribersByZips returns
  lastInbound: string | null; // what lastInboundAt returns
  noAlertChannel: boolean; // the database predates subscribers.alert_channel
}

let db: Db;
let sql: { query: string; params: unknown[] }[];
let twilio: URLSearchParams[];
const realFetch = globalThis.fetch;
const realWarn = console.warn;

function subscriberRow(overrides: Partial<SubscriberRow> = {}): SubscriberRow {
  return {
    id: 1,
    phone_hash: hashPhone(PERSON),
    phone_e164: PERSON,
    language: 'en',
    zip: '92105',
    needs: {},
    consent_at: '2026-11-14T00:00:00.000Z',
    opted_out_at: null,
    alert_channel: null,
    messenger_psid: null,
    messenger_page_id: null,
    ...overrides,
  };
}

function answer(query: string, params: unknown[]): unknown[] {
  if (/insert into subscribers/.test(query)) {
    return [subscriberRow({ zip: String(params[2]), alert_channel: (params[6] as 'whatsapp' | null) ?? null })];
  }
  if (/from subscribers where phone_hash/.test(query)) return db.subscriber ? [db.subscriber] : [];
  if (/from subscribers\s+where opted_out_at is null/.test(query)) return db.active;
  if (/max\(started_at\)/.test(query)) return [{ at: db.lastInbound }];
  if (/select 1 from calls/.test(query)) return [];
  return [{ id: 1 }];
}

beforeEach(() => {
  db = { subscriber: null, active: [], lastInbound: null, noAlertChannel: false };
  sql = [];
  twilio = [];
  delete process.env.TWILIO_WHATSAPP_ALERT_CONTENT_SID;
  console.warn = () => undefined;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://api.twilio.com/')) {
      twilio.push(new URLSearchParams(String(init?.body)));
      return Response.json({ sid: 'SM00000000000000000000000000000001' }, { status: 201 });
    }
    if (url === 'https://db.example.test/sql') {
      const { query, params } = JSON.parse(String(init?.body)) as { query: string; params: unknown[] };
      sql.push({ query, params });
      if (db.noAlertChannel && query.includes('alert_channel')) {
        return Response.json({ message: 'column "alert_channel" does not exist', code: '42703' }, { status: 400 });
      }
      return Response.json({ rows: answer(query, params) });
    }
    throw new Error(`unexpected fetch to ${url}`);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  console.warn = realWarn;
});

const insertsInto = (table: string) => sql.filter((s) => s.query.includes(`insert into ${table}`));

// ---- the route, in a bare Hono app ----

function app(): Hono {
  const server = new Hono();
  server.use(async (c, next) => {
    c.set('mastra' as never, { getLogger: () => undefined } as never);
    await next();
  });
  for (const route of m4ApiRoutes) {
    if ('path' in route && 'handler' in route && route.method === 'POST') server.post(route.path, route.handler as never);
  }
  return server;
}

let sid = 0;
function webhook(body: string, from = `whatsapp:${PERSON}`): Record<string, string> {
  return { MessageSid: `SMwa${++sid}`, From: from, To: `whatsapp:${SENDER}`, Body: body, NumMedia: '0' };
}

async function post(params: Record<string, string>, path = '/m4/twilio/whatsapp', signFor = path): Promise<Response> {
  return app().request(`http://localhost:4111${path}`, {
    method: 'POST',
    headers: { 'X-Twilio-Signature': twilioSignature(PUBLIC_BASE_URL + signFor, params) },
    body: new URLSearchParams(params),
  });
}

describe('fromWhatsAppAddress', () => {
  it('reads whatsapp:+E.164 and refuses anything else', () => {
    assert.equal(fromWhatsAppAddress(`whatsapp:${PERSON}`), PERSON);
    assert.equal(fromWhatsAppAddress(PERSON), null);
    assert.equal(fromWhatsAppAddress('whatsapp:6195550142'), null);
    assert.equal(fromWhatsAppAddress('messenger:7712345678901234'), null);
  });
});

describe('POST /m4/twilio/whatsapp', () => {
  it('signs a JOIN up for WhatsApp alerts and answers in TwiML', async () => {
    const response = await post(webhook('JOIN 92105'));
    assert.equal(response.status, 200);
    assert.match(await response.text(), /<Message>Shade: you are signed up/);

    const [upsert] = insertsInto('subscribers');
    assert.equal(upsert.params[0], hashPhone(PERSON));
    assert.equal(upsert.params[2], '92105');
    assert.equal(upsert.params[6], 'whatsapp');

    const [call] = insertsInto('calls');
    assert.deepEqual(call.params.slice(0, 3), ['inbound', 'whatsapp', hashPhone(PERSON)]);
    // The reply rides on the TwiML response, not a separate send.
    assert.equal(twilio.length, 0);
  });

  it('opts a WhatsApp STOP out', async () => {
    db.subscriber = subscriberRow({ alert_channel: 'whatsapp' });
    const response = await post(webhook('STOP'));
    assert.match(await response.text(), /unsubscribed/);
    assert.ok(sql.some((s) => /update subscribers set opted_out_at/.test(s.query) && s.params[0] === hashPhone(PERSON)));
  });

  it('refuses a bad signature and a sender that is not a whatsapp: address', async () => {
    assert.equal((await post(webhook('HELP'), '/m4/twilio/whatsapp', '/m4/twilio/sms')).status, 403);
    assert.equal((await post(webhook('HELP', PERSON))).status, 400);
    assert.equal(sql.length, 0);
  });

  it('still keeps SMS opt-ins on SMS', async () => {
    const params = { MessageSid: `SMsms${++sid}`, From: PERSON, To: SENDER, Body: 'JOIN 92105' };
    await post(params, '/m4/twilio/sms');
    assert.equal(insertsInto('subscribers')[0].params[6], null);
    assert.equal(insertsInto('calls')[0].params[1], 'sms');
  });
});

describe('a database without subscribers.alert_channel', () => {
  it('still answers and signs up SMS', async () => {
    db.noAlertChannel = true;
    const params = { MessageSid: `SMsms${++sid}`, From: PERSON, To: SENDER, Body: 'JOIN 92105' };
    const response = await post(params, '/m4/twilio/sms');
    assert.match(await response.text(), /signed up/);
    assert.equal(insertsInto('subscribers').length, 2); // the try with alert_channel, then the old statement
  });

  it('refuses a WhatsApp opt-in instead of turning it into an SMS subscription', async () => {
    db.noAlertChannel = true;
    const response = await post(webhook('JOIN 92105'));
    assert.match(await response.text(), /something went wrong/);
    assert.equal(insertsInto('subscribers').length, 1);
  });
});

describe('sendText on WhatsApp', () => {
  it('sends free-form from the WhatsApp sender', async () => {
    const result = await sendText({ to: PERSON, body: 'hello', purpose: 'system', channel: 'whatsapp' });
    assert.deepEqual(result, { ok: true });
    assert.equal(twilio[0].get('From'), `whatsapp:${SENDER}`);
    assert.equal(twilio[0].get('To'), `whatsapp:${PERSON}`);
    assert.equal(twilio[0].get('Body'), 'hello');
    assert.equal(insertsInto('calls')[0].params[1], 'whatsapp');
  });

  it('sends a template by Content SID and variables, without a body', async () => {
    await sendText({
      to: PERSON,
      body: 'log only',
      purpose: 'alert',
      channel: 'whatsapp',
      template: { contentSid: 'HX00000000000000000000000000000001', variables: { '1': 'Heat', '2': 'Library' } },
    });
    assert.equal(twilio[0].get('ContentSid'), 'HX00000000000000000000000000000001');
    assert.deepEqual(JSON.parse(twilio[0].get('ContentVariables')!), { '1': 'Heat', '2': 'Library' });
    assert.equal(twilio[0].get('Body'), null);
  });
});

describe('dispatchAlert', () => {
  const alert: AlertRow = {
    id: 7,
    kind: 'mock',
    nws_id: null,
    zips: ['92105'],
    headline: null,
    onset_at: null,
    expires_at: null,
    detected_at: '2026-11-14T00:00:00.000Z',
    texts_sent: 0,
  };

  it('sends free-form WhatsApp inside the 24-hour window', async () => {
    db.active = [subscriberRow({ alert_channel: 'whatsapp' })];
    db.lastInbound = new Date(Date.now() - 3600_000).toISOString();
    assert.deepEqual(await dispatchAlert(alert), { textsSent: 1 });
    assert.equal(twilio[0].get('To'), `whatsapp:${PERSON}`);
    assert.match(twilio[0].get('Body')!, /Shade TEST/);
  });

  it('sends the template outside the window', async () => {
    process.env.TWILIO_WHATSAPP_ALERT_CONTENT_SID = 'HX00000000000000000000000000000002';
    db.active = [subscriberRow({ alert_channel: 'whatsapp' })];
    db.lastInbound = new Date(Date.now() - 48 * 3600_000).toISOString();
    assert.deepEqual(await dispatchAlert(alert), { textsSent: 1 });
    assert.equal(twilio[0].get('ContentSid'), 'HX00000000000000000000000000000002');
    const variables = JSON.parse(twilio[0].get('ContentVariables')!) as Record<string, string>;
    assert.ok(Object.values(variables).every((value) => value && !value.includes('\n')));
  });

  it('skips a WhatsApp subscriber outside the window when there is no template', async () => {
    db.active = [subscriberRow({ alert_channel: 'whatsapp' })];
    assert.deepEqual(await dispatchAlert(alert), { textsSent: 0 });
    assert.equal(twilio.length, 0);
  });

  it('keeps SMS subscribers on SMS', async () => {
    db.active = [subscriberRow()];
    assert.deepEqual(await dispatchAlert(alert), { textsSent: 1 });
    assert.equal(twilio[0].get('To'), PERSON);
    assert.equal(twilio[0].get('From'), SENDER);
  });
});
