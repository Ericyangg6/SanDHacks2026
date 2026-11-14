# M4: text / outbound

Skeleton for the SMS sender, subscribers, the NWS alert flow and the text agent. Most bodies are stubs that throw
`NotImplementedError`, each with ordered `TODO` steps. Nothing is registered with the Mastra instance yet, so the
app behaves exactly as before.

## Layout

| Path | What it holds |
| --- | --- |
| `env.ts`, `todo.ts`, `types.ts`, `phone.ts` | Lazy env access, the stub helper, row types, E.164 and hashing |
| `shared-types.ts` | Mirror of `data/schema/types.ts` (see "Shared types" below) |
| `db.ts` | Every query M4 needs, stubbed until there is a shared Neon client |
| `find-sites.ts` | The one place M4 calls M2's `find_sites` from |
| `sms/` | Twilio REST client, message templates, `sendSms` (the contract function) and `sendText` (the guarded send path) |
| `subscribers/` | Opt-in, STOP, keyword detection, inbound text routing |
| `alerts/` | NWS polling, zones, re-crawl request, dispatch, mock alerts |
| `agent/` | Text agent prompt, the 911 pre-check, one conversation turn |
| `mastra/` | The Mastra objects: `textAgent`, `alertWorkflow`, `m4ApiRoutes`, `sendSmsTool`, `findSitesTool` |

Already implemented: `toE164`, `hashPhone`, `validateTwilioSignature`, `detectKeyword`, `toAlertKind`, the zone
list, the fixed English and Spanish strings, both HTTP route handlers, the workflow wiring, both tools and the
agent definition.

## Wiring it in

`src/mastra/index.ts` belongs to the app's owner. When the team is ready, the change is:

```ts
import { alertWorkflow, m4ApiRoutes, textAgent } from '../m4';

export const mastra = new Mastra({
  agents: { agent, textAgent },
  workflows: { alertWorkflow },
  server: { apiRoutes: [...m4ApiRoutes] },
  // ...existing config
});
```

Custom routes mount at the server root, so the Twilio messaging webhook is `POST ${PUBLIC_BASE_URL}/m4/twilio/sms`
and the dashboard's demo button calls `POST /m4/alerts/mock` with `{ "zips": ["92105"], "headline": "..." }`.

Before the server gets a public URL: no `server.auth` is configured, so every route is public, including the mock
alert trigger and the starter agent with its file and shell tools.

To poll NWS on a timer, add the `schedule` field described in `mastra/alert-workflow.ts`. It is off on purpose.

## Environment

| Variable | Used for |
| --- | --- |
| `TWILIO_SID`, `TWILIO_SECRET` | Twilio API key pair, authenticates the send request |
| `TWILIO_ACCOUNT_SID` | Account SID (`AC...`), part of the send URL |
| `TWILIO_AUTH_TOKEN` | Validates the signature on inbound webhooks |
| `TWILIO_PHONE_NUMBER` | The sending number, E.164 |
| `PUBLIC_BASE_URL` | Public origin Twilio calls, needed for the signature check |
| `PHONE_SALT` | Salt for `phone_hash`. Must be the same value for M3 |
| `NEON_DATABASE_URL` | Postgres connection string |
| `NWS_USER_AGENT` | Contact string NWS asks for, e.g. `shade-sandhacks (you@example.com)` |
| `TEXT_AGENT_MODEL` | Optional. Defaults to `anthropic/claude-sonnet-5-5` |

All are read on first use, so a missing one does not stop the app from booting. The app does not read the
repo-root `.env`, so put them in `apps/sandhacks/.env` or start with `set -a; . ../../.env; set +a; npm run dev`.

For a Gemini text agent, set `TEXT_AGENT_MODEL=google/<model id>`. Mastra reads the key from `GOOGLE_API_KEY` or
`GOOGLE_GENERATIVE_AI_API_KEY`, not `GEMINI_API_KEY`.

## Shared types

`data/schema/types.ts` cannot be imported from this app: TypeScript rejects files outside `apps/sandhacks`
(TS6059). `shared-types.ts` is a verbatim copy until the team fixes that. Check it with:

```shell
diff <(tail -n +5 apps/sandhacks/src/m4/shared-types.ts) data/schema/types.ts
```

## Decisions that block real work

1. **No sendable number.** `subscribers` stores only `phone_hash`, so an alert has nobody to text. Needs a schema
   change agreed by all four workstreams (see `SubscriberContact` in `types.ts`).
2. **STOP from a non-subscriber.** `zip` and `consent_at` are `NOT NULL`, so an opt-out from someone who only got a
   one-off text from a voice call cannot be recorded.
3. **NWS updates.** Every update to an alert gets a new id, so deduping on `nws_id` alone texts subscribers once per
   update.
4. **Zone to zip.** NWS alerts name forecast zones; nothing maps those to zips yet.
5. **Re-crawl.** How M4 asks M2 for one, and whether texts wait for it to finish.
6. **Double counting.** A voice call that sends a text would log `site_id` twice (M3's row and ours), which the
   ranking's recent-referrals count would see as two.
7. **Alert texts and memory.** The alert text has to be stored in `messages`, or a reply like "something closer?"
   reaches the agent with no context.
8. **Review before real users.** The emergency phrase list, the 911 wording, the 211 free-ride claim and all
   Spanish copy are unreviewed first drafts.
