# M4: text / outbound

The SMS sender, subscribers, the NWS alert flow and the text agent. **Facebook Messenger is the live channel**:
SMS waits on carrier registration and WhatsApp outbound is blocked by Meta. Before changing anything here, read
[`AGENTS.md`](AGENTS.md), the M4 rules for people and coding agents: Messenger first, never touch the WhatsApp code.

## Layout

| Path | What it holds |
| --- | --- |
| `env.ts`, `types.ts`, `phone.ts` | Lazy env access, the shared types from `data/schema/types.ts` plus M4's row types, E.164 and hashing |
| `db.ts` | Every query M4 needs, sent to Neon's HTTPS endpoint with `fetch` (no Postgres package) |
| `find-sites.ts` | The one place M4 calls `find_sites` from. It forwards to the team's `src/shared/find-sites.ts`, a stub until M2 ships |
| `sms/` | Twilio REST client, message templates, `sendSms` (the contract function) and `sendText` (the guarded send path) |
| `subscribers/` | Opt-in, STOP, keyword detection, inbound text routing |
| `alerts/` | NWS polling, zones, re-crawl request, dispatch, mock alerts |
| `agent/` | Text agent prompt, the 911 pre-check, one conversation turn |
| `mastra/` | The Mastra objects: `textAgent`, `alertWorkflow`, `m4ApiRoutes`, `sendSmsTool`, `findSitesTool` |
| `dev/` | `webhook-proxy.mjs`, the only thing a public tunnel should point at (see "Receiving texts on a laptop"), and the dev scripts (see "Dev scripts") |

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

## Messenger modes

The Messenger side of Shade does three things:

| Mode | What happens | Where |
| --- | --- | --- |
| 1. After a phone call | When a call ends, the site the caller was given is held for their linked Messenger profile automatically (no text offer needed), and `send_sms` holds it on request too; it goes out the next time they message the Page | `sms/send-sms.ts` (`followUpAfterCall`, `sendSms`), `messenger/followups.ts`, hook in `elevenlabs/post-call.ts` |
| 2. Full agent | Any message that is not a keyword goes to the text agent: where are you, nearest open site, no car, Spanish, 911 and 211 | `messenger/inbound.ts`, `agent/reply.ts` |
| 3. Heat and AQI alerts | NWS alerts, plus alerts from our own readings (heat index or AQI over a line), go to Messenger subscribers in the zip | `alerts/dispatch.ts`, `alerts/readings.ts` |

**Mode 1 in detail.** A phone call does not open Facebook's 24-hour window, so nothing can be sent the moment the
voice agent asks. `sendSms` looks the caller up by `hashPhone(e164)` in `subscribers.linked_phone_hash` (set by
`JOIN <zip> <phone>` on Messenger). With a profile, the site text goes into `messenger_followups` (kept 7 days) and
`sendSms` returns `{ ok: true, note }`; the next time they message the Page, `deliverFollowups` sends it first,
then the normal reply. STOP drops what is held. Without a profile it returns `no_messenger_profile` and a `note`
telling the voice agent to read the address out and explain how to link Messenger. Nothing goes out by SMS unless
`M4_SMS_ENABLED=1` (carriers block the number's texts until A2P registration, while Twilio still reports them
sent). `apps/api/src/shared/send-sms.ts`, which the ElevenLabs tool calls, forwards to this `sendSms`.

**Automatic.** Nobody has to say yes to a text: linking Messenger with `JOIN <zip> <phone>` is the opt-in. When a
voice call ends, `elevenlabs/post-call.ts` calls `followUpAfterCall` with the caller's number, the first site the
tools gave them and the call language; for a linked, not opted-out caller the site is held the same way. The same
site is never held twice within 2 hours, so a `send_sms` during the call and the automatic follow-up send one
message. Callers without a linked profile get nothing: Facebook offers no way to find someone on Messenger from a
phone number, so the person must write to the Page first.

**Suggested voice prompt lines (M3, `agent/prompts/system.md`).** Draft only; the prompt is M3's:

```text
- After giving a site, say: "If you've linked Shade on Facebook Messenger, the address and map are waiting
  there; just send our Page any message to get them."
- If send_sms returns a `note`, follow the note instead of saying the text is on its way.
- Before ending the call, offer once: "Want heat alerts and addresses on Facebook Messenger? Message the Shadoes
  Page JOIN, your zip code and this phone number."
```

**Mode 3 in detail.** `checkReadingAlerts` reads, for every zip with a subscriber, the newest reading from the last
3 hours (forecast rows more than an hour ahead are left out) and raises a `high_heat_index` alert at heat index
`M4_ALERT_HEAT_INDEX_F` (default 103°F, NWS's "danger" level) or a `high_aqi` alert at `M4_ALERT_AQI` (default
101), at most one per zip and kind every 12 hours. The alert says the value ("dangerously hot ... heat index
106°F") and goes through `dispatchAlert`, so Messenger's 24-hour window and the repeat guards apply. It runs from
`POST /m4/alerts/check-readings` (same `Authorization: Bearer $M4_ALERT_SECRET` as the mock alert) or on a timer
when `M4_READING_ALERT_CRON` is set (`readingAlertWorkflow`). As of 2026-11-14 M2's readings carry heat index
for San Diego zips but no AQI, so AQI alerts wait on an AQI source.

## Facebook Messenger

**Messenger is Shade's live channel** (see `AGENTS.md`): SMS waits on carrier registration and WhatsApp outbound is
blocked by Meta. People write to the Facebook Page (Shadoes) on Messenger. Twilio's Messenger sender posts to its own
route, `POST ${PUBLIC_BASE_URL}/m4/twilio/messenger`, never to the SMS one: the sender is `messenger:<psid>`, a
page-scoped id, not a phone number, so it never goes through `toE164` or `hashPhone`.

- **Gate.** The same `X-Twilio-Signature` check as SMS, against `PUBLIC_BASE_URL` + `/m4/twilio/messenger`. A
  signed post whose `From` or `To` is not a `messenger:` address gets 400.
- **Reply.** The route answers Twilio with an empty `<Response/>` at once, then `handleInboundMessenger` runs the
  turn and sends the reply through the Messages API, from `messenger:<page id>` (the inbound `To`) to
  `messenger:<psid>`. A repeated `MessageSid` within 10 minutes is dropped.
- **Identity.** `hashMessengerId(psid)` = `sha256(PHONE_SALT + 'messenger:' + psid)`, stored where a `phone_hash`
  goes (`messages`, `calls`). It can never equal a phone hash. Logs show `messenger:<first 8 hash chars>`.
- **Keywords, as on SMS.** `JOIN <zip>` (or `UNIRME <zip>`) signs the person up for alerts here: a `subscribers`
  row keyed by the Messenger hash, `alert_channel = 'messenger'`, with the psid and Page id stored in
  `messenger_psid` / `messenger_page_id` so alerts can be sent. `START` signs a past subscriber up again with the
  zip on file. `STOP` stamps `opted_out_at` and clears the stored ids. `HELP` explains. Questions are still answered
  after STOP: it cancels alerts, and the person wrote to us.
- **Phone profile.** `JOIN <zip> <phone>`, e.g. `JOIN 92105 6195551234`, also links the Messenger profile to a
  phone number (`messenger/join.ts` parses it; either order, any common phone format; other words are ignored).
  Only `hashPhone(e164)` is stored, in `subscribers.linked_phone_hash`, never the raw number. The name is not
  typed: at JOIN, `messenger/profile.ts` reads `first_name last_name` from the person's Facebook profile through
  the Graph API and stores it in `display_name`. That needs `FACEBOOK_PAGE_ACCESS_TOKEN` (a Page access token for
  Shadoes, from a Meta app with Messenger access; in development mode Facebook only answers for people with a role
  on that app); without it, or when Facebook does not answer within 3 seconds, the name stays unknown and the
  signup still works. One number links to one profile: a new link moves it. A JOIN without a phone keeps the link
  on file, an unreadable phone number is refused with nothing saved, and STOP clears the link and the name.
  `db.getMessengerProfileByPhone(hashPhone(e164))` finds the active profile for a number. Nothing sends through it
  yet: routing `send_sms` (the voice agent's "text me the address") to the linked Messenger is the next step.
- **Alerts.** `dispatchAlert` sends Messenger subscribers the alert from the Page they joined on
  (`sendMessengerAlert`), with the same per-alert and cooldown guards as SMS. Facebook lets a Page message someone
  only within 24 hours of their last message, and no Messenger message tag covers alerts, so a subscriber who has
  not written in 24 hours is skipped and logged (`messenger_window_closed`). The opt-in confirmation tells people
  this.
- **Agent.** Any other message goes to `generateTextReply` with `channel: 'messenger'`, so the 911 pre-check, the
  AI disclosure and `find_sites` work as for SMS, and a subscriber's zip is on file for the agent.
- **Logging.** Each inbound message gets a `calls` row (`inbound`, `messenger`), which is also what the 24-hour
  window is read from. Replies get no row, as SMS replies get none; a sent alert gets one (`outbound`, `sms_sent`,
  `alert_id`).

**Database.** `data/schema/schema.sql` has the Messenger pieces: the `messenger` value of the `channel` enum,
`'messenger'` in `subscribers.alert_channel`, and `subscribers.messenger_psid` / `messenger_page_id`. The comment
under the `subscribers` table has the `alter` statements for a database created before them.

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

## WhatsApp

WhatsApp is the alert channel that works without US carrier (A2P) registration. Twilio's WhatsApp sender posts
to `POST ${PUBLIC_BASE_URL}/m4/twilio/whatsapp`, never to the SMS route.

- **Same flow as SMS.** A WhatsApp address is `whatsapp:+<E.164>`, a phone number, so the route removes the prefix
  and hands the number to `handleInboundSms` with `channel: 'whatsapp'`. It is hashed like an SMS number: one
  `subscribers` row and one conversation per phone, whichever channel it writes from. STOP, START, HELP, JOIN, the
  911 pre-check and the agent all work, and the reply goes back in TwiML, which Twilio delivers on WhatsApp.
- **Alerts follow the opt-in.** `subscribers.alert_channel` records where alerts go: `whatsapp` after a JOIN or
  START on WhatsApp, null (SMS) after one by text. STOP on either channel opts the number out of both.
- **The 24-hour rule.** WhatsApp delivers a free-form message only within 24 hours of the person's last message
  (`db.lastInboundAt`, from the inbound `calls` rows). `dispatchAlert` sends the normal alert text inside that
  window. Outside it, it sends the approved template (`TWILIO_WHATSAPP_ALERT_CONTENT_SID`, see
  `whatsAppAlertVariables` in `sms/templates.ts` for its text and placeholders) or, with no template set, skips
  that subscriber and logs it.
- **Logging.** `calls` rows carry channel `whatsapp`. A WhatsApp alert that went out still has outcome `sms_sent`
  (`call_outcome` has no channel-neutral value), so the repeat and cooldown guards cover it.

**Database.** Two additive changes in `data/schema/schema.sql`, needed before WhatsApp fully works:

```sql
alter type channel add value 'whatsapp';
alter table subscribers add column alert_channel text check (alert_channel in ('sms', 'whatsapp'));
```

Before they run, SMS behaves as before (subscriber reads retry without `alert_channel`), WhatsApp replies still
work, a WhatsApp JOIN is refused with the "try again" text rather than recorded as an SMS opt-in, and WhatsApp
`calls` rows fail with a log line, so the 24-hour window reads as closed.

**Twilio Console.** Set the WhatsApp sender's incoming-message webhook (Messaging > Senders > WhatsApp senders) to
`${PUBLIC_BASE_URL}/m4/twilio/whatsapp`, HTTP POST. For alerts outside the 24-hour window, create the alert
template in the Content Template Builder, submit it for WhatsApp approval as Utility, and put its `HX...` SID in
`TWILIO_WHATSAPP_ALERT_CONTENT_SID` (and a Spanish one in `TWILIO_WHATSAPP_ALERT_CONTENT_SID_ES`).

**Trying it locally.** `node src/m4/dev/run.mjs text-in "JOIN 92105" --whatsapp` posts a signed WhatsApp webhook
and prints the reply. Tests: `npx tsx --test src/m4/whatsapp.test.ts`.

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

### Live NWS alerts

`alertWorkflow` polls `api.weather.gov` for Extreme Heat Warnings, Heat Advisories and Air Quality Alerts in
San Diego County's four forecast zones and the county code `CAC073` (some Air Quality Alerts use county codes). It
records each alert once by `nws_id`, asks M2 for a re-crawl (a log line for now), and dispatches the new ones.
`alerts/zone-zips.ts` turns zones into zips. It is generated, with its sources and date in its header:

```shell
node src/m4/dev/run.mjs build-zone-zips <path to 2025_Gaz_zcta_national.txt>
```

The schedule is off (see `mastra/alert-workflow.ts`). To poll once by hand against the dev server:

```shell
./node_modules/.bin/mastra api --url http://127.0.0.1:4111 workflow run start alertWorkflow '{"inputData":{}}'
```

### Mock alerts

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
the WhatsApp webhook is `POST ${PUBLIC_BASE_URL}/m4/twilio/whatsapp` (see "WhatsApp"), the Messenger webhook is
`POST ${PUBLIC_BASE_URL}/m4/twilio/messenger` (see "Facebook Messenger"), and the dashboard's demo button calls
`POST /m4/alerts/mock` (see "Alerts").

No `server.auth` is configured, so every route on port 4111 is open to whoever can reach it, including the starter
agent with its file and shell tools. M4's four routes check their own secrets (Twilio's signature and
`M4_ALERT_SECRET`). Never point a tunnel at 4111. `npm run dev` also listens on every network interface, so on
shared Wi-Fi those routes are open to the room: `MASTRA_HOST=127.0.0.1 npm run dev` keeps the server to this
machine.

## Receiving texts on a laptop

Sending needs no public URL. Receiving does: Twilio has to reach the webhook. `dev/webhook-proxy.mjs` listens on
4114 and forwards only `POST /m4/twilio/sms`, `POST /m4/twilio/whatsapp` and `POST /m4/twilio/messenger` to the
Mastra server, answering 404 to everything else, so the tunnel goes to the proxy:

```shell
node src/m4/dev/webhook-proxy.mjs                 # terminal 1, from apps/api
cloudflared tunnel --url http://127.0.0.1:4114    # terminal 2, prints https://<words>.trycloudflare.com
```

Set `PUBLIC_BASE_URL` to that address before starting the dev server, and set the Twilio number's messaging
webhook to `<address>/m4/twilio/sms` (HTTP POST), the WhatsApp sender's to `<address>/m4/twilio/whatsapp`, and the
Messenger sender's to `<address>/m4/twilio/messenger`.
The address changes every time the tunnel restarts, and every one of those places has to change with it: the
signature check fails with 403 if `PUBLIC_BASE_URL` is stale.

## Dev scripts

Run from `apps/api`. Each one loads the repo-root `.env` itself.

```shell
node src/m4/dev/run.mjs send-test ["message"]    # one text to TEST_PHONE_NUMBER, straight through Twilio
node src/m4/dev/run.mjs text-in "JOIN 92105"     # pretend a phone texted the Twilio number; prints the reply
node src/m4/dev/run.mjs call-ended --phone +1...  # pretend a voice call ended: holds the site for the linked Messenger
node src/m4/dev/run.mjs build-zone-zips <file>   # rebuild alerts/zone-zips.ts (see "Live NWS alerts")
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
| `TWILIO_WHATSAPP_FROM` | Optional. The WhatsApp sender's number, E.164. Defaults to `TWILIO_PHONE_NUMBER` |
| `TWILIO_WHATSAPP_ALERT_CONTENT_SID` | Optional. Content SID (`HX...`) of the approved WhatsApp alert template. Without it, WhatsApp alerts only reach people who wrote in the last 24 hours |
| `TWILIO_WHATSAPP_ALERT_CONTENT_SID_ES` | Optional. The Spanish alert template. Spanish subscribers get the default one without it |
| `PUBLIC_BASE_URL` | Public origin Twilio calls, needed for the signature check on every webhook (SMS, WhatsApp, Messenger) |
| `M4_ALERT_SECRET` | Shared secret for `POST /m4/alerts/mock`. The route refuses everything while it is unset |
| `FACEBOOK_PAGE_ACCESS_TOKEN` | Optional. Page access token for Shadoes, used only to read a Messenger subscriber's name from their Facebook profile at JOIN |
| `M4_SMS_ENABLED` | Optional. `1` lets `send_sms` fall back to SMS for callers with no linked Messenger profile. Off until the number is carrier-registered |
| `M4_ALERT_HEAT_INDEX_F`, `M4_ALERT_AQI` | Optional. Reading-alert lines, default 103 (°F) and 101 |
| `M4_READING_ALERT_CRON` | Optional. Cron (Pacific time) for checking readings automatically, e.g. `*/15 * * * *`. Unset = on demand only |
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
- **Zone to zip.** A generated table from Census ZIP-area points and the NWS zone polygons (`alerts/zone-zips.ts`).
  A county-coded alert (`CAC073`) means every zip in it.
- **NWS updates.** Every update to an alert gets a new id, so deduping on `nws_id` alone would text subscribers
  once per update. `dispatchAlert` adds a cooldown: at most one text per subscriber per alert kind every
  `ALERT_TEXT_COOLDOWN_HOURS` (12), read from the `calls` rows we already write. Mock alerts skip it.

## Not done yet

- **Real texts.** Everything has run in dry run only. The Twilio trial account cannot send these texts; once it is
  upgraded with its own number, set `TWILIO_PHONE_NUMBER`, point the number's messaging webhook at the tunnel, and
  start with `node src/m4/dev/run.mjs send-test`.
- **The voice line's texts.** M3's `src/shared/send-sms.ts` is still their logging stub, and its comment says M4
  replaces the body. The change is to forward to `sendSms` from `../m4`.
- **`find_sites`.** M4 calls the team's stub in `src/shared/find-sites.ts`, which returns the same two El Cajon
  sites for every location until M2 ships.

## Decisions that block real work

1. **STOP from a non-subscriber.** `zip` and `consent_at` are `NOT NULL`, so an opt-out from someone who only got a
   one-off text from a voice call cannot be recorded.
2. **Re-crawl.** How M4 asks M2 for one, and whether texts wait for it to finish.
3. **Double counting.** A voice call that sends a text would log `site_id` twice (M3's row and ours), which the
   ranking's recent-referrals count would see as two.
4. **Lost alerts.** Only alerts that are new in a poll reach dispatch, so if dispatch fails, the next poll sees the
   alert as recorded and never texts for it. Dispatching every still-active alert on each poll would fix that
   (dispatch already skips anyone texted), at the cost of more queries per poll.
5. **Review before real users.** The emergency phrase list, the 911 wording, the 211 free-ride claim and all
   Spanish copy are unreviewed first drafts.
