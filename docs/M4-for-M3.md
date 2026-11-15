# M4 → M3: Messenger follow-ups after a phone call

For Eric. What M4 (texting) needs from the voice side so a caller gets the site on Facebook Messenger after the
call. About 15 minutes of work, all on the voice server and in the ElevenLabs dashboard.

## Why

SMS from our Twilio number can't reach US phones (no A2P registration), and WhatsApp is blocked by Meta. Shade's
text channel is now **Facebook Messenger** (the Shadoes Page). A person links their Messenger to their phone number
by messaging the Page:

```
JOIN 92105 6195551234
```

After that, when they call the Shade line, the site they were given can be sent to their Messenger. Facebook only
lets the Page message someone within 24 hours of their last message, and a phone call doesn't count, so the site is
**held** and goes out the next time they message the Page ("📞 From your call with Shade:" then the address, hours
and map link).

## What's already in `main`

| File | Change |
| --- | --- |
| `apps/api/src/shared/send-sms.ts` | Your re-export of M4's `sendSms`, kept. Comment updated. |
| `apps/api/src/m4/sms/send-sms.ts` | `sendSms` looks the caller up by phone hash. Linked to Messenger: holds the site and returns `{ ok: true, note }`. Not linked: returns `{ ok: false, error: 'no_messenger_profile', note }`. No SMS goes out unless `M4_SMS_ENABLED=1`. With `M4_SMS_DRY_RUN=1` the text is only logged, so the `docs/DEMO.md` fallback still works. |
| `apps/api/src/elevenlabs/post-call.ts` | One hook, after your `insertCall`, in a `finally`, inbound calls only: `followUpAfterCall(...)` holds the call's first site for a linked caller **without them having to say yes to a text**. It never throws, so your calls row is unaffected. |
| `data/schema/types.ts` | `SendSmsOutput` gained an optional `note`: what to tell the caller about delivery. |

## What you need to do

### 1. Pull `main` and restart your server

Your ngrok server is the one ElevenLabs calls (`find_sites`, `send_sms`). As of 2026-11-15 04:51 UTC it is not
running this code: a call where the caller said yes to the text held nothing. Same Neon database and the same
`PHONE_SALT` as everyone else, or the phone lookup won't match.

### 2. Turn on the post-call webhook in ElevenLabs

It doesn't exist yet: the Shade agent has `post_call_webhook_id: null` and the workspace has no webhooks. That's
also why the `calls` table has **no voice rows** at all (your `post-call.ts` never runs).

1. ElevenLabs dashboard → Agents → Settings → **Post-call webhook** → create a webhook:
   - URL: `https://<your ngrok host>/el/webhooks/post-call`
   - Auth: HMAC. Copy the signing secret.
2. Put the secret in your `.env` as `ELEVENLABS_WEBHOOK_SECRET` and restart.
3. Make sure the webhook is selected as the post-call webhook with the **transcript** event, for the Shade agent.

Check: make a call, hang up, and a `voice` row should appear in `calls` within a minute or so.

### 3. Pass the `note` through in `apps/api/src/elevenlabs/tool-send-sms.ts`

On failure you replace M4's result with "The text didn't go through". For a caller without linked Messenger that
loses the instructions on how to link it. One line:

```ts
// before
return { ok: false, error: code === 'opted_out' ? OPTED_OUT : NOT_SENT, code };
// after
return { ok: false, error: code === 'opted_out' ? OPTED_OUT : (result.note ?? NOT_SENT), code };
```

On success you already return `result`, so the `note` reaches the agent.

### 4. Prompt (`agent/prompts/system.md`)

"I've sent it. It should arrive in a minute." is wrong now: it arrives when they next message the Page. Suggested
replacement for the `send_sms` bullets:

```text
- Then offer: "Would you like the address and directions on Facebook Messenger?" If yes, call `send_sms` with that
  site's `site_id`.
  - If it returns a `note`, follow the note: it says what to tell the caller about delivery.
  - If it fails with no note, say its `error` text, then read the site's address slowly, once.
- Before ending the call, offer once: "Want heat alerts and addresses on Facebook Messenger? Message the Shadoes
  Page JOIN, your zip code and this phone number."
```

Then re-sync the agent (`npm run el:sync`).

## How to test

1. On Messenger, send the Shadoes Page `JOIN 92105 <your 10-digit number>`. Reply: "✅ … Linked to the phone
   number ending in …".
2. Call the Shade number **from that phone**, get a site, hang up (saying yes to the text offer is optional now).
3. Message the Page anything. The held site arrives first ("📞 From your call with Shade:"), then the normal reply.

Without a real call, from `apps/api`: `node src/m4/dev/run.mjs call-ended --phone +1XXXXXXXXXX --zip 92105` runs the
same hold step.

## If something's off

- **Nothing held after a call:** is there a `voice` row in `calls` for the call? No row means the post-call webhook
  isn't reaching your server (step 2). A row but nothing held means the caller's number isn't linked
  (`JOIN <zip> <phone>` from that phone's owner) or your server is on old code (step 1).
- **ngrok URL changed:** update the tool URLs (`npm run el:sync` with the new `PUBLIC_API_URL`) **and** the
  post-call webhook URL.
- **Details:** `apps/api/src/m4/README.md`, section "Messenger modes". Ask Alex (M4).
