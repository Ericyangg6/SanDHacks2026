# Shade

**One phone number that finds the nearest cool, clean-air place that's open right now.** Built at SanD Hacks 2026
for San Diego County heat waves and wildfire smoke.

San Diego County runs free cooling centers ("Cool Zones"), plus libraries, rec centers and senior centers that
anyone can sit in. But the list is scattered across PDFs, map layers and city pages, hours change, and the people
who need it most often don't have a smartphone, a car, or English as a first language. Shade puts all of it behind
one phone call.

## What it does

- **Call the line.** An AI voice agent asks where you are (an address, cross streets, a landmark like "Parkway
  Plaza", or a zip), and names the closest site that is open **now** with enough time left to get there, how to get
  there without a car, and whether to call ahead. English, Spanish and Chinese on the same number.
- **Get it on Messenger.** People who link their Facebook Messenger (`JOIN <zip> <phone>` to the Shadoes Page) get
  the address, hours and map link from their call there, can keep asking the text agent ("no car", "something
  closer?", "en español"), and receive heat and air-quality alerts for their zip.
- **Alerts before people are in trouble.** A workflow watches the National Weather Service and our own readings
  (heat index, AQI) and messages everyone signed up in the affected zips with their nearest open site.
- **A dashboard for the county.** Open cool zones, heat and AQI by zip, where calls are coming from, and help
  requests a dispatcher can accept.
- **Safe by design.** Heat-illness symptoms get "call 911" before any model runs. Shade says it is an AI. Phone
  numbers are stored only as salted hashes, and no names are kept.

## How it works

```
             phone call                                  Facebook Messenger
caller ──► Twilio ──► ElevenLabs voice agent            resident ──► Twilio (Messenger) ─┐
                         │  tools: find_sites, send_sms,                                  │
                         │         request_help                                           ▼
                         └────────────────────────────► Mastra API (apps/api) ◄──────────┘
                                                          │  find_sites ranking, text agent (Claude),
                                                          │  NWS + reading alerts, dashboard API
                                                          ▼
   Bright Data (scrape) + Gemini (extract) ──► Neon Postgres ◄── NWS forecasts, US Census
                                              sites, hours, landmarks, readings,
                                              calls, subscribers, alerts, requests
```

| Piece | What it does |
| --- | --- |
| **ElevenLabs Agents** | The voice: speech, conversation (Gemini 2.5 Flash), language detection. Calls our tools by webhook |
| **Twilio** | The phone number, and the Facebook Messenger channel |
| **Mastra** (`apps/api`) | The API server: voice tools, the Messenger text agent, alert workflows, the dashboard API |
| **Neon Postgres** | One database for sites, hours, landmarks, readings, calls, subscribers, alerts and help requests |
| **Bright Data** | Scrapes official county pages, Google Maps listings, and Maps reviews (AC and crowding signals) |
| **Gemini** | Reads each site's own page for hours, holiday closures and who is allowed in |
| **Claude** | The Messenger text agent |
| **Google Geocoding** | Addresses and cross streets ("Main and Magnolia") to exact locations |
| **NWS, US Census** | Heat alerts and forecasts; seniors and car-free households per zip |

## The data

No unified list of cooling spaces existed, so we built one from the open web
([`docs/DATA_EVIDENCE.md`](docs/DATA_EVIDENCE.md) has every number, computed from the pipeline's own logs):

- **563 sites** across **93 zips**: 120 official (county or city), 443 discovered on the web. Discovered sites are
  always presented as "call ahead".
- **Nothing a model extracts is trusted on its own.** Every extracted site carries a quote that must appear
  verbatim in the source page (96% pass; the rest are rejected), and the site's own hours are checked in code
  against Google Maps hours. Disagreements are flagged, not guessed.
- **Every scraped page is versioned**, so a changed page is detected and re-checked; an NWS alert triggers a re-crawl
  of the affected zips.
- **Cooling-gap analysis**: NWS forecasts plus Census data on residents 65+ and households without a car, against
  sites within 5 km of each zip, to find where coverage is missing and fill it.

## Run locally

You need 3 terminals. All secrets go in the root `.env` (copy `.env.template` to start). Never commit `.env`.

### One-time setup

```bash
# Node 22.13+ required
cd apps/api && npm install

# ngrok (public URL so ElevenLabs can reach your laptop)
brew install ngrok
ngrok config add-authtoken <token from dashboard.ngrok.com>
```

### Terminal 1: Mastra API

```bash
cd apps/api
npm run dev
```

The server runs on http://localhost:4111. Restart it after any `.env` change.

### Terminal 2: ngrok tunnel

```bash
ngrok http 4111
```

Copy the `https://….ngrok-free.app` URL into `.env`:

```
PUBLIC_API_URL=https://xxxx.ngrok-free.app
```

No trailing slash. The free URL changes every time ngrok restarts. When it does, update `PUBLIC_API_URL`, then
restart terminal 1 and run `npm run el:sync`.

### Terminal 3: ElevenLabs agent

```bash
cd apps/api
npm run el:sync            # push prompts/config/tool URLs to ElevenLabs (first run prints ELEVENLABS_AGENT_ID)
npm run el:simulate        # text-only dry run: en, es, zh, emergency scenarios
npm run el:simulate -- zh  # run one scenario
```

To connect the Twilio number once (needs `TWILIO_ACCOUNT_SID` starting with `AC`, `TWILIO_AUTH_TOKEN`, and
`TWILIO_PHONE_NUMBER` in `.env`):

```bash
npm run el:import-number   # prints ELEVENLABS_PHONE_NUMBER_ID
```

Then call the Twilio number. Terminals 1 and 2 must stay running for the agent's tools to work. For call logging
and the after-call Messenger follow-up, set up the ElevenLabs post-call webhook (see
[`agent/README.md`](agent/README.md), setup step 5).

### Messenger (text agent and alerts)

Twilio's Messenger sender posts to `POST /m4/twilio/messenger`. Expose only the webhook paths, never the whole
server: `apps/api/src/m4/dev/webhook-proxy.mjs` forwards just the Twilio routes.

```bash
cd apps/api
node src/m4/dev/webhook-proxy.mjs                    # port 4114
cloudflared tunnel --url http://127.0.0.1:4114       # prints https://<words>.trycloudflare.com
PUBLIC_BASE_URL=https://<words>.trycloudflare.com MASTRA_HOST=127.0.0.1 npm run dev
```

In the Twilio Console, open Numbers & senders → Facebook Messenger → your Page, set **Webhook URL for incoming
messages** to `https://<words>.trycloudflare.com/m4/twilio/messenger` (POST), and save. Then message the Page
`HELP` or `JOIN 92105`. Details, dev scripts and tests: [`apps/api/src/m4/README.md`](apps/api/src/m4/README.md).

### Ops dashboard

With terminal 1 running, serve the static dashboard:

```bash
python -m http.server 8765 --bind 127.0.0.1 --directory apps/dashboard
```

Open http://127.0.0.1:8765/index.html. The page polls `GET /dashboard/state` every 10 s. The API reads Neon when
`NEON_DATABASE_URL` is set. Otherwise it serves `data/seed/`, and the dashboard shows "Seed data".

- `?api=https://xxxx.ngrok-free.app` points the page at another API.
- `?now=2026-11-16T11:00:00-08:00` replays a moment (open hours, recent calls) for demos.

### Quick checks

```bash
# Is the API up? (401 = running, rejected because no secret was sent)
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:4111/el/tools/find-sites

# Is ngrok forwarding to it? (should also be 401)
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$(grep ^PUBLIC_API_URL= .env | cut -d= -f2- | tr -d ' "')/el/tools/find-sites"

# Does find_sites return open sites right now?
cd apps/api && npm run sites:check -- "El Cajon, no car"
```

## Layout

```
apps/api/        Mastra server
  src/elevenlabs/  voice tool endpoints and the post-call webhook
  src/shared/      find_sites, hours, geocoding, database (shared by voice and text)
  src/m4/          Messenger text agent, alerts, subscribers (see its README and AGENTS.md)
  src/dashboard/   dashboard state API
apps/dashboard/  static ops dashboard and resident directions page (no build step)
agent/           ElevenLabs agent definition: prompts, tools, sync/test scripts
ingest/          data pipeline: Bright Data scraping, Gemini extraction, verification, Neon loader
data/schema/     Neon schema, migrations, shared types, contracts between workstreams
data/seed/       seed snapshot of sites, places and readings
docs/            project plan, per-workstream plans (M1 to M4), demo script, data evidence
```

## Privacy and safety

- **Phone numbers:** E.164 in transit, `sha256(PHONE_SALT + number)` at rest. The only raw contact details kept are
  what an opted-in subscriber needs to receive alerts, cleared on STOP. Logs never contain a raw number or
  Messenger id.
- **Consent:** alerts are opt-in only (`JOIN`), and `STOP` opts out. Asking for a text during a call is consent for
  that one message.
- **Emergencies:** Shade is not an emergency line. Heat-illness symptoms get "call 911" from a fixed phrase list
  before any model runs.
- **Honesty:** official vs discovered sites, verified-when, and mock data are always labeled.

## Current limits

- **SMS** from our Twilio number is blocked by US carriers until A2P 10DLC registration, so texts go through
  Facebook Messenger. The SMS code is in place and turns on with `M4_SMS_ENABLED=1`.
- **Messenger** only lets the Page message someone within 24 hours of their last message, so alerts reach
  subscribers who wrote recently, and an after-call follow-up arrives the next time they message the Page.
- **WhatsApp** is built but parked: Meta restricts the unverified business account.
- **Air quality:** heat-index readings are live; AQI alerts wait on an AQI data source.

## More

- [`docs/PROJECT.md`](docs/PROJECT.md): product, architecture, ranking formula
- [`docs/DEMO.md`](docs/DEMO.md): the 3-minute live demo script
- [`docs/DATA_EVIDENCE.md`](docs/DATA_EVIDENCE.md): how the data was collected and verified
- [`devpost.md`](devpost.md): the hackathon writeup
