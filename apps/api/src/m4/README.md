# M4: text / outbound

The SMS sender, subscribers, the NWS alert flow and the text agent. What is not built yet is a stub that throws
`NotImplementedError`, with ordered `TODO` steps.

## Layout

| Path | What it holds |
| --- | --- |
| `env.ts`, `todo.ts`, `types.ts`, `phone.ts` | Lazy env access, the stub helper, the shared types from `data/schema/types.ts` plus M4's row types, E.164 and hashing |
| `db.ts` | Every query M4 needs, sent to Neon's HTTPS endpoint with `fetch` (no Postgres package) |
| `find-sites.ts` | The one place M4 calls `find_sites` from. It forwards to the team's `src/shared/find-sites.ts`, a stub until M2 ships |
| `sms/` | Twilio REST client, message templates, `sendSms` (the contract function) and `sendText` (the guarded send path) |
| `subscribers/` | Opt-in, STOP, keyword detection, inbound text routing |
| `alerts/` | NWS polling, zones, re-crawl request, dispatch, mock alerts |
| `agent/` | Text agent prompt, the 911 pre-check, one conversation turn |
| `mastra/` | The Mastra objects: `textAgent`, `alertWorkflow`, `m4ApiRoutes`, `sendSmsTool`, `findSitesTool` |
| `dev/` | `webhook-proxy.mjs`, the only thing a public tunnel should point at (see "Receiving texts on a laptop"), and the dev scripts (see "Dev scripts") |

Built: the Twilio sender, every query in `db.ts`, `sendSms` and `sendText`, the site text (English and Spanish),
inbound texts (STOP, START, HELP, JOIN and the hand-off to the agent), `subscribe`, `optOut`, `isOptedOut`, the
alert text, `dispatchAlert` with its repeat and cooldown guards, the mock alert and its secret, the text agent
turn (`generateTextReply`) and the 911 pre-check (`looksLikeEmergency`),
`toE164`, `hashPhone`, the webhook signature check, `toAlertKind`, the zone list, the fixed English and Spanish
strings, both HTTP route handlers, the workflow wiring, both tools and the agent definition.

Still stubs: `recordAlert`, `fetchActiveAlerts`, `zipsForZones` and `requestRecrawl` (the live NWS flow).

## Receiving a text

`handleInboundSms` never throws. When something fails, the texter gets a "try again, or call 211" reply instead of
silence.

| Text | What happens | Reply |
| --- | --- | --- |
| `STOP`, `ALTO`, ... (the whole text) | `opted_out_at` set, stored number cleared | Unsubscribed. Twilio answers its own English STOP words itself, so ours only arrives for the Spanish ones |
| `START`, `INICIAR`, ... | Signs a past subscriber up again with their zip | Signed up, or "reply JOIN and your zip" for a number that never joined |
| `JOIN 92105`, `UNIRME 92105` | `subscribe` with that zip | Signed up, or the JOIN usage line when there is no zip |
| `HELP`, `AYUDA`, ... | Nothing | The help text |
| Anything else | Text agent, unless the number opted out | The agent's answer. No reply at all to an opted-out number |

A Spanish keyword is answered in Spanish and makes Spanish the subscriber's language. Every inbound text gets a
`calls` row (`inbound`, `sms`). Keyword texts have a null outcome, because `call_outcome` has no value for them.
Twilio sometimes delivers a message twice. A repeated `MessageSid` within 10 minutes gets the first reply again and
is not handled twice. That memory lives in the server process, so a restart clears it.

## Facebook Messenger

People can also write to the Facebook Page (Shadoes) on Messenger. Twilio's Messenger sender posts to its own
route, `POST ${PUBLIC_BASE_URL}/m4/twilio/messenger`, never to the SMS one: the sender is `messenger:<psid>`, a
page-scoped id, not a phone number, so it never goes through `toE164` or `hashPhone`.

- **Gate.** The same `X-Twilio-Signature` check as SMS, against `PUBLIC_BASE_URL` + `/m4/twilio/messenger`. A
  signed post whose `From` or `To` is not a `messenger:` address gets 400.
- **Reply.** The route answers Twilio with an empty `<Response/>` at once, then `handleInboundMessenger` runs the
  turn and sends the reply through the Messages API, from `messenger:<page id>` (the inbound `To`) to
  `messenger:<psid>`. A repeated `MessageSid` within 10 minutes is dropped.
- **Identity.** `hashMessengerId(psid)` = `sha256(PHONE_SALT + 'messenger:' + psid)`, stored where a `phone_hash`
  goes (`messages`, `calls`). It can never equal a phone hash. Logs show `messenger:<first 8 hash chars>`.
- **Keywords.** No subscriber rows. Messenger allows a reply for 24 hours after the person writes, and Twilio tags a
  later message `ACCOUNT_UPDATE`, which alerts may not use, so alerts stay on SMS. JOIN and START point people at
  `TWILIO_PHONE_NUMBER`, HELP gets a Messenger help text, and STOP gets an acknowledgement: Shade never starts a
  Messenger conversation, so there is nothing to switch off.
- **Agent.** Any other message goes to `generateTextReply` with `channel: 'messenger'`, so the 911 pre-check, the
  AI disclosure and `find_sites` work as for SMS.
- **Logging.** Each inbound message gets a `calls` row (`inbound`, `messenger`). The reply gets no row, as SMS
  replies get none.

**Database.** `messenger` is a new value of the `channel` enum in `data/schema/schema.sql`. A database created
before it needs `alter type channel add value 'messenger';`. Until then, Messenger `calls` inserts fail with a log
line, and replies still go out.

**Twilio Console.** Open the Page's sender under Numbers & senders > Facebook Messenger and set its incoming-message
webhook to `${PUBLIC_BASE_URL}/m4/twilio/messenger`, HTTP POST. If the sender sits in a Messaging Service, the
service's Integration settings decide which webhook is called instead. Do not put the Messenger sender and the phone
number in one service that sends every message to a single URL. Leave the phone number's webhook on `/m4/twilio/sms`.

**Trying it locally.** Start the server with `M4_SMS_DRY_RUN=1`, then post a signed Messenger webhook:

```shell
M4_SMS_DRY_RUN=1 MASTRA_HOST=127.0.0.1 npm run dev                  # terminal 1
node src/m4/dev/run.mjs messenger-in "HELP"                          # terminal 2; the reply is in terminal 1
node src/m4/dev/run.mjs messenger-in "cooling center near 92105?" --psid 1000000000000001
```

The route answers before the reply is sent, so the reply is in the server log, not in `messenger-in`'s output.
The default ids are made up. Clean up with the `hashMessengerId` value of the `--psid` you used, as in "Dev scripts".

The automated tests replace `fetch`, so they reach neither Neon nor Twilio:

```shell
npx tsx --test src/m4/messenger/messenger.test.ts
```

## The text agent

Any text that is not a keyword goes to `generateTextReply`, one turn of the conversation:

1. **911 first.** `looksLikeEmergency` matches fixed English and Spanish phrases (`EMERGENCY_PHRASES` in
   `agent/safety.ts`) before any model call. A match gets the fixed 911 text and outcome `escalated_911`.
2. **History.** The last 20 `messages` rows for the number, oldest first, including the alert text that started
   the conversation, plus a system note with the subscriber's zip, language, needs and the local time. No phone
   number reaches the model or the traces.
3. **The agent** (`textAgent`, `TEXT_AGENT_MODEL`, default Claude Sonnet) runs with `find_sites` and at most 4
   steps, and is cut off after 11 seconds so the webhook still answers inside Twilio's 15.
4. **AI disclosure** is added in code to the first reply in a conversation, not left to the prompt.
5. **Outcome** comes from the last `find_sites` result: `site_given` (with `site_id`), `no_site_found` or `error`.
   A failed or empty run replies "try again, or call 211" with outcome `error`.

Both sides of the turn are saved to `messages`. Measured with the stand-in `find_sites`: model turns take 3 to 7
seconds, the 911 path about 0.2.

`MAX_OUTPUT_TOKENS` is 1,500 although replies are about 300 characters: Claude's thinking counts against the cap,
and a lower one cut replies off.

## Sending a text

`sendSms({ to, site_id, language })` is the contract function M3 calls: it looks the site up, builds the text and
sends it. `sendText` is the path under it that every other M4 text uses. Neither throws. A failure comes back as
`{ ok: false, error }`:

| `error` | Meaning |
| --- | --- |
| `invalid_number`, `invalid_body` | Not a phone number, or an empty or over-long text |
| `opted_out` | The number replied STOP. Nothing was sent |
| `opt_out_check_failed` | The database could not be asked, so nothing was sent |
| `site_not_found`, `lookup_failed` | `sendSms` only: no such `site_id`, or the site lookup failed |
| `twilio_<code>` | Twilio refused the text, e.g. `twilio_21610` for a number that sent STOP to Twilio |
| `send_failed` | Twilio could not be reached |

A text that goes out gets one `calls` row (`outbound`, `sms`, `sms_sent`). A text that does not go out gets none.

## Alerts

`dispatchAlert` texts every active subscriber in the alert's zips, one at a time, with the nearest open site from
`find_sites` (or a "call 211" line when there is none). A subscriber is skipped when they already got a text for
this alert, or, for real alert kinds, a text for any alert of the same kind in the last 12 hours. Each text gets a
`calls` row with `alert_id`, is saved to `messages` so a reply has context, and adds to `alerts.texts_sent`.

The dashboard's demo button:

```shell
curl -X POST http://localhost:4111/m4/alerts/mock \
  -H "Authorization: Bearer $M4_ALERT_SECRET" -H 'Content-Type: application/json' \
  -d '{"zips": ["92105"], "headline": "Demo"}'
```

It answers `201 { alert }` with `texts_sent` filled in, `401` without the secret (always, while `M4_ALERT_SECRET`
is unset), and `400` for a bad body. A mock alert says it is a test, skips the 12-hour cooldown and the re-crawl,
and texts the zips again on every press.

## Wiring

`src/mastra/index.ts` belongs to the app's owner. M4's part of it is three additions and nothing else:

```ts
import { alertWorkflow, m4ApiRoutes, textAgent } from '../m4';

export const mastra = new Mastra({
  server: { apiRoutes: [...elevenLabsRoutes, ...m4ApiRoutes] },
  agents: { agent, textAgent },
  workflows: { alertWorkflow },
  // ...existing config
});
```

Custom routes mount at the server root, so the Twilio messaging webhook is `POST ${PUBLIC_BASE_URL}/m4/twilio/sms`,
the Messenger webhook is `POST ${PUBLIC_BASE_URL}/m4/twilio/messenger` (see "Facebook Messenger"), and the
dashboard's demo button calls `POST /m4/alerts/mock` (see "Alerts").

No `server.auth` is configured, so every route on port 4111 is open to whoever can reach it, including the starter
agent with its file and shell tools. M4's three routes check their own secrets (Twilio's signature, `M4_ALERT_SECRET`). Never point a tunnel at 4111. `npm run dev`
also listens on every network interface, so on shared Wi-Fi those routes are open to the room:
`MASTRA_HOST=127.0.0.1 npm run dev` keeps the server to this machine.

To poll NWS on a timer, add the `schedule` field described in `mastra/alert-workflow.ts`. It is off on purpose.

## Receiving texts on a laptop

Sending needs no public URL. Receiving does: Twilio has to reach the webhook. `dev/webhook-proxy.mjs` listens on
4114 and forwards only `POST /m4/twilio/sms` and `POST /m4/twilio/messenger` to the Mastra server, answering 404
to everything else, so the tunnel goes to the proxy:

```shell
node src/m4/dev/webhook-proxy.mjs                 # terminal 1, from apps/api
cloudflared tunnel --url http://127.0.0.1:4114    # terminal 2, prints https://<words>.trycloudflare.com
```

Set `PUBLIC_BASE_URL` to that address before starting the dev server, and set the Twilio number's messaging
webhook to `<address>/m4/twilio/sms` (HTTP POST), and the Messenger sender's to `<address>/m4/twilio/messenger`.
The address changes every time the tunnel restarts, and every one of those places has to change with it: the
signature check fails with 403 if `PUBLIC_BASE_URL` is stale.

## Dev scripts

Run from `apps/api`. Each one loads the repo-root `.env` itself.

```shell
node src/m4/dev/run.mjs send-test ["message"]    # one text to TEST_PHONE_NUMBER, straight through Twilio
node src/m4/dev/run.mjs text-in "JOIN 92105"     # pretend a phone texted the Twilio number; prints the reply
```

`text-in` stands in for a phone until the Twilio number can receive. It signs the request the way Twilio does
and posts it to the running dev server (`M4_SERVER_URL`, default `http://localhost:4111`), so it needs
`TWILIO_AUTH_TOKEN` and the same `PUBLIC_BASE_URL` the server was started with. It texts from the fictional
`+16195550100` unless given `--from <number>`. The rows it writes are real, so delete them afterwards:

```sql
-- phone_hash of +16195550100 with your PHONE_SALT
delete from calls where phone_hash = '<hash>';
delete from messages where phone_hash = '<hash>';
delete from subscribers where phone_hash = '<hash>';
```

## Dry run

`M4_SMS_DRY_RUN=1` stops every text at the last step: it is written to the server log with a masked number and
never reaches Twilio. Everything before that step runs as normal, so the `calls` and `messages` rows are still
written. Use it until the Twilio account can send.

```shell
M4_SMS_DRY_RUN=1 node src/m4/dev/run.mjs send-test
```

## Environment

| Variable | Used for |
| --- | --- |
| `M4_SMS_DRY_RUN` | Optional. `1` logs texts instead of sending them |
| `TEST_PHONE_NUMBER` | Dev scripts only: where `send-test` sends |
| `M4_SERVER_URL` | Dev scripts only: where `text-in` and `messenger-in` post. Defaults to `http://localhost:4111` |
| `TWILIO_MESSENGER_PAGE_ID` | Dev scripts only, optional: the Page id `messenger-in` writes to. The server reads the Page from each inbound `To` and needs no setting |
| `TWILIO_ACCOUNT_SID` | Account SID (`AC...`), part of the send URL |
| `TWILIO_AUTH_TOKEN` | Validates the signature on inbound webhooks, and authenticates sends when there is no API key pair |
| `TWILIO_SID`, `TWILIO_SECRET` | Optional. A Twilio API key pair (`SK...`). When both are set, sends use it instead of the auth token |
| `TWILIO_PHONE_NUMBER` | The sending number, E.164. Messenger replies quote it when pointing people at SMS alerts |
| `PUBLIC_BASE_URL` | Public origin Twilio calls, needed for the signature check on both webhooks (SMS and Messenger) |
| `M4_ALERT_SECRET` | Shared secret for `POST /m4/alerts/mock`. The route refuses everything while it is unset |
| `PHONE_SALT` | Salt for `phone_hash`. Must be the same value for M3 |
| `NEON_DATABASE_URL` | Postgres connection string |
| `NWS_USER_AGENT` | Contact string NWS asks for, e.g. `shade-sandhacks (you@example.com)` |
| `TEXT_AGENT_MODEL` | Optional. Defaults to `anthropic/claude-sonnet-5-5` |

All are read on first use, so a missing one does not stop the app from booting. `npm run dev` loads the
repo-root `.env` (`mastra dev --env ../../.env`). Variables only one run needs, such as `M4_SMS_DRY_RUN=1`, can go
in front of it: `M4_SMS_DRY_RUN=1 MASTRA_HOST=127.0.0.1 npm run dev`.

For a Gemini text agent, set `TEXT_AGENT_MODEL=google/<model id>`. Mastra reads the key from `GOOGLE_API_KEY` or
`GOOGLE_GENERATIVE_AI_API_KEY`, not `GEMINI_API_KEY`.

## Decided

- **A sendable number.** `phone_hash` stays the key everywhere. `subscribers` has one nullable `phone_e164`
  column, set on opt-in and cleared on STOP, so an alert has a number to send to. The column is in the shared
  `data/schema/schema.sql`. A database already created from the old schema needs
  `alter table subscribers add column phone_e164 text;`.
- **NWS updates.** Every update to an alert gets a new id, so deduping on `nws_id` alone would text subscribers
  once per update. `dispatchAlert` adds a cooldown: at most one text per subscriber per alert kind every
  `ALERT_TEXT_COOLDOWN_HOURS` (12), read from the `calls` rows we already write. Mock alerts skip it.

## Decisions that block real work

1. **STOP from a non-subscriber.** `zip` and `consent_at` are `NOT NULL`, so an opt-out from someone who only got a
   one-off text from a voice call cannot be recorded.
2. **Zone to zip.** NWS alerts name forecast zones; nothing maps those to zips yet.
3. **Re-crawl.** How M4 asks M2 for one, and whether texts wait for it to finish.
4. **Double counting.** A voice call that sends a text would log `site_id` twice (M3's row and ours), which the
   ranking's recent-referrals count would see as two.
5. **Review before real users.** The emergency phrase list, the 911 wording, the 211 free-ride claim and all
   Spanish copy are unreviewed first drafts.
