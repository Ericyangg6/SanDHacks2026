# Live demo script (3:00)

Read-off script for the Shade demo, following the outline in [PROJECT.md](PROJECT.md#demo-script-3-min).
**Bold** = say it out loud. *Italics* = what to do or what should happen. Times are cumulative.

Roles (fill in names):
- **Presenter:** talks to the judges, runs the clock
- **Driver:** laptop on the projector (dashboard, server log)
- **Sweaty Teammate:** plays the overheated caller in the hook skit (props: a paper fan, a towel or water bottle)
- **Phone A:** hands a phone to a judge for the call (or calls on speaker)
- **Phone B:** teammate who receives the alert on Messenger

---

## Before the demo (T–15 min)

- [ ] `npm run dev` running in `apps/api`, ngrok running, `PUBLIC_API_URL` matches the tunnel, then `npm run el:sync`
- [ ] Quick check: `npm run sites:check -- "El Cajon, no car"` returns 2 open sites **at the demo time**
      (most libraries close at 5 PM and drop out after 4:30). If empty, pick the area that returns sites and use it below.
- [ ] Call the Shade number once yourself. Confirm the greeting, a site, and the text.
- [ ] Text delivery: if real SMS doesn't arrive (carrier block, Twilio error 30034), set `M4_SMS_DRY_RUN=1`,
      restart, and show the text in the server log instead.
- [ ] Phone B has written to the Shadoes Facebook Page **within the last 24 hours** and sent `JOIN 92105`
      (Messenger only lets us message someone within 24 h of their last message).
- [ ] `M4_ALERT_SECRET` is set; dashboard open on the projector; the mock-alert button works.
- [ ] Phone volume up, speakerphone tested in the room.
- [ ] The Shade number written large on a card or slide.
- [ ] Architecture slide ready for "How it's built": caller → Twilio → ElevenLabs → Mastra → Neon, with Bright Data + Gemini feeding Neon. Put the ElevenLabs, Bright Data and Neon logos biggest.

---

## 0:00 – 0:30 · Hook

*Infomercial skit. Presenter plays an over-the-top TV host; **Sweaty Teammate** shuffles on, fanning themselves with a paper, wiping their forehead. Big energy, big gestures, keep it moving.*

**Presenter** *(bursting in, arms wide)*:
> **"Hey everybody! Do you have a HARD time finding shade when it's BURNING outside?!"**

*Point at the audience, hand cupped to ear. Get a "yeah!" (or point at a judge until they nod).*

**Sweaty Teammate** *(dramatic, collapsing a little)*:
> **"It's ninety degrees, my apartment has no AC, my phone's at 2%, and I don't have a car! Where do I even GO?!"**

**Presenter** *(gasp, hand on chest)*:
> **"Are you tired of melting? Tired of googling 'cooling center near me' and getting a page that closed in October?"**

**Sweaty Teammate:**
> **"YES!"**

**Presenter** *(holding up a phone like a product)*:
> **"Well, have we got the number for YOU! Just call Shade!"**

*Beat. Drop the infomercial voice, step forward, normal tone:*

**Presenter:**
> **"Okay, but seriously. San Diego County runs free cooling centers called Cool Zones. They closed October 31st, and last week it hit 90 degrees. Most people don't know they exist, and the people who need them most often don't have a smartphone, a car, or English as a first language. So we built Shade: one phone number that finds the nearest cool place that's open right now. Let's call it."**

---

## 0:30 – 1:20 · Live call

*Phone A hands the phone to a judge (speaker on), or calls on speaker. (Or keep the skit going: Sweaty Teammate makes the call on speaker, still fanning.)*

**Presenter:**
> **"Call this number and tell it where you are. Try: 'I'm in El Cajon, I don't have a car.'"**

*Expected:*
1. *Shade greets: says it's an automated AI assistant, mentions 911 for emergencies, asks for an address or cross streets.*
2. *Judge: "I'm in El Cajon, I don't have a car."*
3. *Shade asks once for the nearest cross street (it only has the city, and the caller is on foot). If the judge gives one, e.g. "Main and Magnolia", Shade confirms the intersection.*
4. *Shade names the closest open site (e.g. El Cajon Branch Library), says it's official, how long it stays open, and the walking or transit time.*
5. *Shade offers a text. Judge says yes. Within a minute the judge's phone gets the address, hours today, and a map link.*

**Presenter, while the text arrives:**
> **"No app, no menu, no English required. It only recommends places open right now, with enough time left to get there."**

*If the call stalls or drops: Driver runs `npm run sites:check -- "El Cajon, no car"` on the projector and the Presenter narrates the same result.*

---

## 1:20 – 2:05 · How it's built

*Driver puts the architecture slide on the projector (caller → ElevenLabs → Mastra → Neon ← Bright Data).*

**Presenter, ElevenLabs (~12s):**
> **"The voice you just heard is an ElevenLabs agent. ElevenLabs handles listening, the conversation, and speaking, in real time over a regular phone line through Twilio. It also detects the caller's language, so the same number works in English, Spanish, and Chinese. When it needs an answer, it calls tools on our Mastra server."**

**Presenter, Bright Data (~15s):**
> **"The hard part is knowing which places exist and when they're open. Nobody publishes that in one place. We used Bright Data to scrape the county's official Cool Zone pages, Google Maps listings for every library, rec center, and senior center, and over two thousand Google reviews, which tell us whether a place actually has AC or is packed. Then Gemini read each site's own web page for its hours, holiday closures, and who's allowed in."**

**Presenter, Neon (~13s):**
> **"All of that lands in Neon Postgres: 412 sites, 116 official and 296 we found on the web, nearly 7,000 landmarks so a caller can say 'I'm at Parkway Plaza' instead of a zip code, and every version of every source page we've scraped. Every call reads from Neon in real time, and the dashboard and the alerts read from the same database."**

**Presenter, wrap (~5s):**
> **"Mastra ties it together: the voice tools, the text agent, and the heat-alert workflow."**

---

## 2:05 – 2:35 · Outbound alert

**Presenter:**
> **"Shade doesn't just wait for calls. A Mastra workflow watches the National Weather Service, and when a heat alert hits, it messages everyone who signed up in that zip."**

*Driver clicks the **mock alert** button on the dashboard (zip 92105).*
*Fallback: in a terminal,*
```shell
curl -X POST http://localhost:4111/m4/alerts/mock \
  -H "Authorization: Bearer $M4_ALERT_SECRET" -H 'Content-Type: application/json' \
  -d '{"zips": ["92105"], "headline": "Demo"}'
```

*Phone B's Messenger gets the alert with the nearest open site. Phone B holds it up and replies: "I don't have a car."*

*Expected: the text agent answers with a walkable or transit option.*

> **"Same Neon data, same site finder as the phone line. Opt-in only: send JOIN and your zip, and STOP turns it off."**

---

## 2:35 – 2:50 · Dashboard

*Driver walks through the dashboard on the projector.*

**Presenter:**
> **"And this is the county's view, straight from Neon. Every call shows up by zip, so you can see where people need help, next to the heat forecast and where seniors and households without a car live."**

*Point at: the call you just made appearing, the help-requests list, heat by zip.*

---

## 2:50 – 3:00 · Close

**Presenter:**
> **"Shade: one phone number, any language, the nearest cool place that's actually open. Voice by ElevenLabs, data from Bright Data, stored and served by Neon. Thank you."**

---

## Tech stack cheat sheet (for Q&A)

| Tool | What it does in Shade | Where you see it in the demo |
|---|---|---|
| **ElevenLabs Agents** | The voice agent: speech-to-text, conversation (Gemini 2.5 Flash as its LLM), voice, language detection, calls our tools by webhook | The live call; "How it's built" |
| **Twilio** | The phone number (imported into ElevenLabs), the text after the call, Messenger alerts and replies | Dialing in, the text, Phone B's alert |
| **Mastra** | Our API server: the `find_sites` and `send_sms` tools the voice agent calls, the text agent, the NWS alert workflow, the dashboard API | Every answer the agent gives; the alert and the reply |
| **Neon (Postgres)** | Sites, hours, landmarks, readings, calls, subscribers, alerts | "How it's built", every answer, the dashboard |
| **Bright Data** | Scrapes official county pages, Google Maps listings (hours, location), and Maps reviews (AC and crowding signals) | "How it's built": 412 sites, 2,040 reviews scanned |
| **Gemini** | Reads each site's web page and extracts structured hours, holiday closures, and access rules | Why hours and "open now" are trustworthy |
| **Claude** | The model behind the Messenger text agent | Phone B's "no car" reply |
| **Google Geocoding** | Turns addresses and cross streets ("Main and Magnolia") into exact locations | Shade confirming the intersection |
| **NWS + US Census** | Heat alerts and forecasts; seniors and car-free households per zip for the heat-gap map | The alert and the dashboard map |

Likely questions:
- **"How do you know it's open?"** Hours from the site's own page (Gemini) cross-checked against Google Maps (Bright Data), plus holiday exceptions; stale data is never presented as open.
- **"What about privacy?"** Phone numbers are stored only as salted hashes; no names. Texts are opt-in, STOP opts out.
- **"Is it an emergency line?"** No. It screens for heat-illness signs and tells people to call 911.

---

## If something breaks

| Problem | Do this |
|---|---|
| Call doesn't connect | Driver: check ngrok is up and `PUBLIC_API_URL` matches; meanwhile narrate with `sites:check` on screen |
| "No open site" | It's late; libraries closed. Re-call with an area that `sites:check` showed open, or say "after hours it sends people to 2-1-1 for a free ride" (that's the real fallback) |
| Text doesn't arrive | Show the text in the server log (`M4_SMS_DRY_RUN=1`) and say "carrier registration for our number is pending" |
| Alert doesn't reach Phone B | Phone B hasn't messaged the Page in 24 h: send any message to the Page and press the button again |
| Agent mishears the location | Say a zip instead: "92020" |
| Anyone mentions an emergency on the call | Shade tells them to hang up and call 911. That's the designed behavior; point it out |
