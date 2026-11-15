# SanDHacks: Shade

A phone line for finding cool, clean air during heat waves and wildfire smoke. See [`docs/PROJECT.md`](docs/PROJECT.md) for the full plan.

## Run locally

You need 3 terminals. All secrets go in the root `.env` (copy `.env.template` to start).

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

No trailing slash. The free URL changes every time ngrok restarts. When it does, update `PUBLIC_API_URL`, then restart terminal 1 and run `npm run el:sync`.

### Terminal 3: ElevenLabs agent

```bash
cd apps/api
npm run el:sync            # push prompts/config/tool URLs to ElevenLabs (first run prints ELEVENLABS_AGENT_ID)
npm run el:simulate        # text-only dry run: en, es, zh, emergency scenarios
npm run el:simulate -- zh  # run one scenario
```

To connect the Twilio number once (needs `TWILIO_ACCOUNT_SID` starting with `AC`, `TWILIO_AUTH_TOKEN`, and `TWILIO_PHONE_NUMBER` in `.env`):

```bash
npm run el:import-number   # prints ELEVENLABS_PHONE_NUMBER_ID
```

Then call the Twilio number. Terminals 1 and 2 must stay running for the agent's tools to work.

### Ops dashboard

With terminal 1 running, start the dashboard (React + TypeScript, Vite):

```bash
cd apps/web && npm install && npm run dev
```

Open http://localhost:5173. The page polls `GET /dashboard/state` and `GET /dispatch/requests` every 10 s. It imports its response types from `apps/api`, so `npm run typecheck` fails when the API contract changes. The API reads Neon when `NEON_DATABASE_URL` is set. Otherwise it serves `data/seed/`, and the dashboard shows "Seed data".

- `?api=https://xxxx.ngrok-free.app` points the page at another API.
- `?now=2026-11-16T11:00:00-08:00` replays a moment (open hours, recent calls) for demos.

`apps/dashboard/index.html` is the earlier static version of the same page. The resident directions page (`apps/dashboard/directions.html`) is still static, and its street routes are mock data in `apps/dashboard/mock.js`. No volunteer table exists yet.

### Quick checks

```bash
# Is the API up? (401 = running, rejected because no secret was sent)
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:4111/el/tools/find-sites

# Is ngrok forwarding to it? (should also be 401)
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$(grep ^PUBLIC_API_URL= .env | cut -d= -f2- | tr -d ' "')/el/tools/find-sites"
```

## Layout

```
apps/api/      Mastra server: ElevenLabs tool endpoints (src/elevenlabs), dashboard state (src/dashboard), shared find_sites/send_sms/hours/db (src/shared)
apps/web/       Ops dashboard: React + TypeScript (Vite), reads apps/api
apps/dashboard/ Resident directions page and the earlier static ops dashboard (no build step)
agent/         ElevenLabs agent definition: prompts, tools, sync/test scripts (see agent/README.md)
data/schema/   Neon schema, shared types, contracts between workstreams
docs/          Project plan and per-workstream plans (M1 to M4)
```
