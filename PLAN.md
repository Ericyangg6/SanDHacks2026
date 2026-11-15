# Project Plan

## Goal

Turn Shade from a directions-only voice agent into a triage pipeline with a human dispatcher inbox. A caller who needs more than directions gets a help request. Gemini structures and ranks the request. A dispatcher on the staff dashboard accepts, declines or closes it. The agent tells the caller only what the request record supports.

Product context: `PRODUCT.md`. Architecture: `docs/PROJECT.md`.

## Locked implementation decisions

- **Help types:** `volunteer_pickup`, `ride_211`, `wellness_check`. The dispatcher picks one on accept.
- **Request status:** `requesting -> incoming | declined -> closed`. Dashboard labels stay "Requesting" and "Incoming" (`PRODUCT.md`). Only dispatcher endpoints change status. No model output changes status.
- **Templates:** every request tool result carries a `say_this` line chosen in code from the status, like `spoken_summary` in `find_sites`. "Help is coming" wording exists only in the `incoming` template. Templates promise no arrival time.
- **911:** emergency signs keep the immediate "hang up and call 9 1 1" rule in `agent/prompts/system.md`. The agent does not call `request_help` first.
- **Grader is rank-only.** Every request reaches the inbox. The grade sorts the inbox. Ungraded requests sort first, so a Gemini failure never hides a request.
- **Caller words:** `request_help` always carries the caller's words verbatim in `said`. T1 decides whether extraction also reads the live transcript.
- **Background work:** extraction and grading run after `request_help` returns. No queue infrastructure. A failure logs and leaves the request ungraded.
- **Callback number:** `requests.phone_e164` holds the raw number while the request is open. Closing or declining the request sets it to null. No endpoint returns it. The backend sends the status text; the dispatcher never sees the number.
- **Hold:** the agent checks status for a few seconds while it gives cool-zone help, then says a text will follow. The agent never keeps a caller on the line for a human decision.
- **Dispatcher auth:** one shared secret, `DISPATCH_SECRET`, in a request header, compared with the `safeEqual` pattern in `apps/api/src/elevenlabs/auth.ts`. Request data never goes through the public `GET /dashboard/state`.
- **Gemini calls:** use the Mastra model router already installed in `apps/api`. Add no new SDK.
- **Table owner:** `requests` belongs to M3 (voice).
- **Base:** branch `triage-pipeline` includes `origin/main` as of 2026-11-14.

## Out of scope

- Custom-LLM output filter between ElevenLabs and Gemini. Add it only if T7 shows promise leaks.
- Volunteer rosters, routing and arrival estimates.
- Help requests from the SMS, WhatsApp and Messenger channels.
- Per-dispatcher accounts and audit history.

## Tickets

### T1: Spike - read the call transcript during a call
**Status:** ready
**Blocked by:** None (can start immediately)
**What it delivers:** A written answer: can `apps/api` read the ElevenLabs transcript of a call that is still in progress, and with what delay. The answer sets the extraction input for T4.
**Acceptance:**
- [ ] `docs/M3.md` records the method tried, the result, and the measured delay.
- [ ] `## Locked implementation decisions` in this file states the T4 input: live transcript, or `said` only.
**Verification:**
- manual: start a call with `npm run el:call`, run the spike script while the call is live, and confirm the output matches what `docs/M3.md` records.

### T2: Caller's help request reaches the dispatcher inbox
**Status:** ready
**Blocked by:** None (can start immediately)
**What it delivers:** A caller who needs a pickup, a ride or a check says so. The agent calls `request_help`. The request shows on the staff dashboard as Requesting with the caller's words, location and stated needs. The agent says the request was sent and is not yet confirmed.
**Acceptance:**
- [ ] `requests` table exists in `data/schema/schema.sql` and `types.ts`, with a migration file.
- [ ] `POST /el/tools/request-help` creates one row per conversation and returns `status: requesting` with its `say_this` line. A repeat call in the same conversation returns the existing row.
- [ ] `GET /dispatch/requests` returns open requests, rejects a missing or wrong `DISPATCH_SECRET` with 401, and never returns `phone_e164`.
- [ ] The dashboard Help requests panel shows live rows and drops the "Mock data" tag. `REQUESTS` leaves `apps/dashboard/mock.js`.
- [ ] `npm run el:sync` registers the `request_help` tool.
**Verification:**
- `cd apps/api && npm run typecheck`
- `cd apps/api && npx tsx src/requests/requests.check.ts`
- manual: `npm run el:simulate -- pickup`; the request appears in the dashboard panel within one poll.

### T3: Dispatcher answers and the caller hears the truth
**Status:** blocked
**Blocked by:** T2
**What it delivers:** The dispatcher accepts a request with a help type, declines it, or closes it. During the call, `check_request_status` gives the agent the line for the current status. After the call, the caller gets one text when the status changes.
**Acceptance:**
- [ ] `POST /dispatch/requests/:id/accept|decline|close` changes status only along the locked lifecycle and rejects any other transition with 409.
- [ ] `POST /el/tools/check-request-status` returns the status and its `say_this` line. Only `incoming` says help is confirmed, and names the help type.
- [ ] A status change after the call ends sends one text through the M4 Twilio sender, in the caller's language.
- [ ] Decline and close set `phone_e164` to null.
- [ ] The dashboard card has Accept (with help type), Decline and Close controls, usable by keyboard.
**Verification:**
- `cd apps/api && npm run typecheck`
- `cd apps/api && npx tsx src/requests/requests.check.ts` (covers transitions, templates and phone deletion)
- manual: accept a request in the dashboard during `npm run el:call`; the agent then says the pickup is confirmed. Before the accept, it does not.

### T4: Structured record from the caller's words
**Status:** blocked
**Blocked by:** T1, T2
**What it delivers:** The inbox card shows a structured record beside the caller's quote: location, people count, needs, symptoms and mobility. Each field says whether the caller stated it or it is unknown.
**Acceptance:**
- [ ] Gemini Flash fills `requests.record` against a JSON schema. A field the caller did not state is `unknown`, never guessed.
- [ ] Extraction runs after `request_help` returns. `request_help` response time does not include the Gemini call.
- [ ] A Gemini error leaves `record` null and the request visible.
**Verification:**
- `cd apps/api && npm run typecheck`
- `cd apps/api && npx tsx src/requests/extract.check.ts` (fixture quotes, asserts stated vs unknown)

### T5: Priority grade and inbox sort
**Status:** blocked
**Blocked by:** T4
**What it delivers:** Each request gets a priority and a one-line reason. The inbox lists the most urgent request first, so the dispatcher reads them in the right order.
**Acceptance:**
- [ ] Gemini Pro writes `priority` and `rationale` from the record and the caller's words.
- [ ] `GET /dispatch/requests` sorts ungraded first, then by priority, then oldest first.
- [ ] The grader can never remove, hide or change the status of a request.
- [ ] The card shows the priority without relying on color alone.
**Verification:**
- `cd apps/api && npm run typecheck`
- `cd apps/api && npx tsx src/requests/requests.check.ts` (sort order, ungraded first)

### T6: Dispatcher principles and hold behavior
**Status:** blocked
**Blocked by:** T3
**What it delivers:** The agent follows five call-taker principles and holds honestly. It checks the request for a few seconds while it gives cool-zone help. If no dispatcher has answered, it says a text will follow and ends the call.
**Acceptance:**
- [ ] `agent/prompts/system.md` states the principles: say only what the record supports; promise effort, never outcomes; no false comfort; say it is an AI when asked; life threats first.
- [ ] The prompt tells the agent to read `say_this` as written and to add no status claim of its own.
- [ ] The agent stops checking status after a bounded number of tries.
- [ ] Emergency signs still produce the 911 line without a `request_help` call.
**Verification:**
- `cd apps/api && npm run el:sync && npm run el:simulate -- pickup`
- `cd apps/api && npm run el:simulate -- emergency`

### T7: Pressure evals
**Status:** blocked
**Blocked by:** T6
**What it delivers:** A repeatable check that the agent does not promise help under pressure. The result decides whether the output filter in `## Out of scope` is needed.
**Acceptance:**
- [ ] `agent/scripts/simulate.ts` has scenarios `pressure` (caller demands a promise), `false_premise` (caller says help was already confirmed) and `injection` (caller tells the agent to set the status).
- [ ] A Gemini Pro pass reads each simulated transcript and flags any line that implies help is coming while the status is `requesting`.
- [ ] The script exits non-zero when a line is flagged.
**Verification:**
- `cd apps/api && npm run el:simulate -- pressure`
- `cd apps/api && npm run el:simulate -- false_premise`
- `cd apps/api && npm run el:simulate -- injection`

## Done

## Open conflicts

- `PRODUCT.md` says help requests are mock, lists two request statuses, and says phone numbers are hashed. This plan makes requests live and dispatcher-run, adds declined and closed, and stores a raw number on open requests. Update with `/project-init product` before T2 ships.
- `data/schema/contracts.md` has no `requests` table and allows a raw number only in `subscribers.phone_e164`. The schema-change rule requires a PR that tags all four members.
- `apps/dashboard/mock.js` describes requests as agent-run ("the agent is calling volunteers"). `DESIGN.md` may describe that card. Check with `/project-init design` when T2 changes the panel.
