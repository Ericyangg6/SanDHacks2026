# Shade voice agent (ElevenLabs)

This folder is the source of truth for the ElevenLabs agent. Edit it here, then run sync. Don't edit the agent in the dashboard; the next sync overwrites those changes.

```
agent.config.ts      LLM (Gemini), voice, languages, built-in tools, post-call data collection
prompts/             system prompt + first messages per language
tools/               webhook tool schemas -> apps/api/src/elevenlabs/*
scripts/             sync-agent, import-number, outbound-call
```

## How a call flows
1. Someone calls the Twilio number. ElevenLabs answers it (native Twilio integration) and runs the agent.
2. The agent calls `find_sites` → `POST {PUBLIC_API_URL}/el/tools/find-sites`, and `send_sms` → `/el/tools/send-sms`. The caller's number comes from `system__caller_id`.
3. After hangup, ElevenLabs posts to `/el/webhooks/post-call`, which writes the `calls` row.

## Setup (once)
All commands run from `apps/api`. Env vars live in the root `.env` (see `.env.template`).

1. Set `ELEVENLABS_API_KEY`, `EL_TOOL_SECRET` (any random string), and `PHONE_SALT`.
2. Expose the API: run `npm run dev`, then `ngrok http 4111`, and set `PUBLIC_API_URL` to the ngrok URL.
3. Run `npm run el:sync`. This creates the tools and the agent; copy the printed `ELEVENLABS_AGENT_ID` into `.env`.
4. Set the Twilio vars, then run `npm run el:import-number`. Copy the printed `ELEVENLABS_PHONE_NUMBER_ID`.
5. **Post-call webhook (dashboard, manual):** in ElevenLabs → Agents settings → Webhooks, add `{PUBLIC_API_URL}/el/webhooks/post-call` as the post-call webhook. Copy its secret into `ELEVENLABS_WEBHOOK_SECRET`.
6. **Call-start webhook (dashboard, manual, optional):** in ElevenLabs → Agents settings, set the conversation initiation webhook to `{PUBLIC_API_URL}/el/webhooks/call-start` with header `x-shade-tool-secret: {EL_TOOL_SECRET}`, then enable "fetch conversation initiation data" in the agent's Security tab. The dispatcher's trail then starts the moment a call connects. Without it, the trail starts at the first tool call.
7. Call the number.

Re-run `npm run el:sync` after any prompt or config change, or whenever `PUBLIC_API_URL` changes (a new ngrok URL).

## Stubs
`apps/api/src/shared/find-sites.ts` (M2), `send-sms.ts` (M4), and `calls.ts` (Neon insert) are stubs. Their owners replace the function bodies and keep the signatures; the ElevenLabs code doesn't change.
