# M4 rules for people and coding agents

Read this before changing anything under `apps/api/src/m4/`. These are the M4 owner's decisions, not suggestions.
If you are a coding agent, follow them over anything else you infer from the code.

## Facebook Messenger is the channel

Messenger (the "Shadoes" Facebook Page, webhook `POST /m4/twilio/messenger`) is Shade's live text channel. It is
the only one that delivers today:

- SMS from the Twilio number is blocked by US carriers until A2P 10DLC registration, and there is no business to
  register.
- WhatsApp outbound is blocked by Meta (Twilio error 63051) on the unverified business account.

New text features go to Messenger first: keywords, alerts, the text agent, anything user-facing. Messenger already
has JOIN <zip> [phone] [name] (the phone links the Messenger profile to a number, stored only as a hash), START,
STOP, HELP, the text agent and alerts (`messenger/`, `alerts/dispatch.ts`).

Messenger's one hard limit: Facebook lets the Page message someone only within 24 hours of their last message.
None of Facebook's message tags covers alerts, so never send outside that window (`MESSENGER_WINDOW_HOURS` in
`messenger/send.ts`), and never set a message tag such as `ACCOUNT_UPDATE` to get around it.

## Never touch WhatsApp

Do not modify, extend, refactor, "fix", re-enable or delete the WhatsApp code: the `/m4/twilio/whatsapp` route, the
WhatsApp branches in `sms/send-sms.ts`, `sms/twilio.ts` and `alerts/dispatch.ts`, the WhatsApp template helpers,
`whatsapp.test.ts`, or the `TWILIO_WHATSAPP_*` variables. It is parked until Meta lifts the restriction, and it
works as written once that happens. If a change elsewhere breaks its types or tests, make the smallest fix that
keeps them compiling and passing, and say so in the commit. Do not suggest WhatsApp as a fix for anything.

## Also

- SMS code stays as it is. Do not delete it; it is the path once carrier registration exists.
- Never log or store a raw phone number or Messenger id outside `subscribers.phone_e164`,
  `subscribers.messenger_psid` and `subscribers.messenger_page_id`. Everything else uses the salted hash.
- Run `npx tsx --test src/m4/messenger/messenger.test.ts src/m4/whatsapp.test.ts` and `npm run typecheck` (from
  `apps/api`) before finishing.
