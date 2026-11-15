# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Static HTML/CSS/JS, no build step (user asked for "something really light and quick"). Leaflet from CDN. The ops dashboard reads sites, readings, calls, alerts and subscriber counts from `GET /dashboard/state` on `apps/api` (Neon, or `data/seed/` without it). Help requests and the directions page are still mock data.

## Users

- **County staff and responders** at a desk during a heat or smoke event. Job: see which cool zones are open and how full, watch heat and AQI, and spot residents who need a pickup so help goes out without a second call.
- **Residents** on a phone, often outdoors in heat, often without a car, sometimes older or unwell. They tap a link in a text and need to get to the nearest open cool zone.

## Product Purpose

Shade is a phone line for finding cool, clean air. Residents call or text, say where they are, and get the nearest open cooling center with directions by text. On an NWS heat or smoke alert it texts opted-in residents first. Full description: `docs/PROJECT.md`.

## Positioning

Works on any phone with no app, reaches out before people are in trouble, and passes what a caller already said (no car, dehydrated, mobility issues) to responders so nobody has to ask twice.

## Operating Context

- Staff dashboard: desktop, also shown on a projector for the demo.
- Resident directions page: opened from an SMS link on a phone, in daylight.
- Demo zips: El Cajon 92020, La Jolla 92037, City Heights 92105.

## Capabilities and Constraints

- Staff dashboard shows three things: live active cool zones, readings (AQI, temperature, heat index), and the locations of calls with each caller's stated needs and request status.
- Request status has two values: **Requesting** and **Incoming**.
- Resident page shows a simple map with the visual route, a step list, bus routes, and zone changes or updates.
- Heat-illness symptoms: the agent tells the caller to call 911. Shade never stands in for 911.
- No names stored; phone numbers are hashed. Nothing on screen identifies a caller beyond location and stated needs.
- Sites are either official or discovered; discovered sites carry "call ahead".
- Mock data must be labeled as mock.

## Brand Commitments

- Working name: Shade.
- Binding visual direction from the user: a blue, white, watery theme. Dashboard panels use a liquid glass material modeled on Apple's Liquid Glass. The map is a pale blue chart with a fine grid and round tokens. This replaces the first direction (cream paper map, dark frosted glass, orange accent). Details: `DESIGN.md`.

## Evidence on Hand

- The dashboard shows the M2 seed: 271 real sites with scraped hours, and NWS forecasts for 111 zips. Calls, alerts and subscribers appear once M3/M4 write them to Neon.
- Help requests, volunteer status, routes, and the directions page's bus steps are still invented.

## Product Principles

- The map is the workspace; panels sit on it, never replace it.
- A person in need outranks every other mark on the screen.
- Say how sure we are: official vs discovered, mock vs live, verified when.
- The resident page must work one-handed, in sunlight, for someone who feels unwell.

## Accessibility & Inclusion

Residents skew older and may be heat-affected: large tap targets, high contrast, no reliance on color alone for status. Languages planned: en, es, tl, vi, zh.
