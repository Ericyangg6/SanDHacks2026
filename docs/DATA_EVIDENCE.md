# Data evidence

*Generated 2026-11-14 23:19 UTC by `ingest/report.ts`. Every number below is computed from the pipeline's logs, caches, git history and seed files, not typed in. Re-run it to refresh.*

## What this is

A maintained, verified dataset of free public cooling spaces in San Diego County, built from the open web. No unified list existed: the county's Cool Zones live in a PDF and a map layer, libraries and rec centers on separate city pages, and nothing says who may enter or whether hours are current.

## Coverage

| | |
|---|---|
| Sites in the seed | 271 |
| Official (published by a government or county source) | 115 |
| Discovered (found on the open web) | 156 |
| ZIP codes covered | 85 |
| Hours confirmed by two independent sources | 40 |
| Source disagreements flagged (call ahead) | 9 |
| Sites with capacity known | 80 |
| Stated as open to everyone | 101 |
| Access restricted (age, members, students) | 3 |

By type: library 74, rec_center 81, senior_center 29, mall 13, community_center 31, other 42, cool_zone 1.

### Growth (from git history of `data/seed/sites.json`)

| When | Commit | Sites | Change |
|---|---|---|---|
| Nov 14 12:59 | `dc00068` | 67 | Add seed snapshot, schema proposal and Neon branch loader |
| Nov 14 13:38 | `3f7f907` | 138 | Add official county Cool Zones source, sorted seed and richer verifica |
| Nov 14 14:05 | `146d2e8` | 149 | Add on-demand search, extraction cache, matching fix and 149-site seed |
| Nov 14 15:19 | `4135345` | 271 | entireb ackend omg help |

## How the data was collected

| | |
|---|---|
| Search-result pages cached (Bright Data SERP) | 506 |
| Web pages cached | 811 |
| Page fetches recorded in the version log | 1363 |
| Distinct URLs fetched | 1041 |
| Fetches that succeeded (target returned content) | 904 (66%) |
| Fetches refused by Bright Data's policy (government domains) | 137 |
| Government-domain pages fetched successfully (served by a second fetcher, since Bright Data refuses .gov) | 229 |
| Fetches that failed for other reasons | 322 (target statuses: 0×143, 200×96, 402×3, 403×14, 429×10, 502×56) |
| Google Maps places (Bright Data Maps scraper) | 243 |
| Pages whose content changed between fetches | 20 |

**A real scraping problem we handled.** Bright Data's Web Unlocker answers HTTP 200 even when the target site failed or the domain is refused. We request the JSON envelope and read the *target's* real status and the `x-brd-error` header, so a refusal is detected and logged instead of being mistaken for an empty page. Government domains are refused by policy; 137 such fetches are in the log, and those pages are routed to a second fetcher.

**Search results sometimes carry only redirect links.** About 60% of Google results come back as opaque redirects. We rebuild the real URL from the visible address when it is complete and drop the result otherwise, so nothing is guessed.

## Verification: nothing the model says is trusted on its own

Every extracted site must carry a quote copied from the source page, and the code checks that the quote appears verbatim in the page text.

| | |
|---|---|
| Records the extractor produced | 832 |
| Passed the verbatim-quote check | 801 (96%) |
| Rejected (quote not found in the source) | 31 (4%) |

Hours from the site's own page are then compared, in code, against Google Maps hours: they agree within 30 minutes, or the site is flagged. That comparison is deterministic and auditable, so no model decides whether two sources agree.

### Disagreements caught

- **La Jolla Recreation Center**: sat: maps 09:00-15:00 vs web 10:00-14:00; fri: maps 10:00-19:00 vs web 12:00-18:00
- **Lakeside Community Center**: thu: maps 12:00-20:00 vs web 10:00-18:00; wed: maps 12:00-20:00 vs web 10:00-18:00
- **San Diego County Library – Lakeside**: fri: maps 10:00-17:00 vs web 09:00-20:00; thu: maps 10:00-18:00 vs web 09:00-20:00
- **San Marcos Community Center**: thu: maps 08:30-17:30 vs web 10:00-18:00; wed: maps 08:30-17:30 vs web 10:00-18:00
- **Santee Public Library**: wed: maps 10:00-18:00 vs web 12:00-19:00
- **City Heights Recreation Center**: fri: maps 11:00-19:00 vs web 10:00-19:00; thu: maps 11:00-19:00 vs web 10:00-19:00

### Evidence quotes, examples

- **San Diego County Library – Bonita-Sunnyside Branch** (91902): "Mon 10:00am-6:00pm ... Sat 10:00am-5:00pm"
- **Chula Vista Public Library Civic Center Branch** (91910): "Mon 10:00am-8:00pm ... Sun 1:00pm-5:00pm"
- **Parkway Aquatic Center** (91910): "8:00am- 2:00pm / 4:00pm- 7:00pm ... 8:00am- 2:00pm"
- **South Chula Vista Library** (91911): "Mon 10:00am-8:00pm ... Sun 1:00pm-5:00pm"

## The data keeps itself current

Every fetch is recorded with a content hash. A new hash means the page changed, and the added and removed lines are stored. 20 page(s) have changed between fetches so far. Re-running `./ingest/run-all.sh --refresh` re-checks every page, and `ingest/alert-refresh.ts` does the same for the ZIPs in a forecast zone when the National Weather Service issues a heat or air-quality alert.

## Where coverage is thin (and the process for it)

The cooling-gap analysis combines the NWS hourly forecast, Census residents who are 65+ or live in households without a vehicle, and the number of sites within 5 km of each ZIP.

| | |
|---|---|
| San Diego County ZIPs analyzed | 111 |
| Populated ZIPs with no site within 5 km | 12 |
| At-risk residents in those ZIPs | 36,661 |

Worst served: 92026 (10,107 at-risk, 0 sites within 5 km); 92040 (8,079 at-risk, 0 sites within 5 km); 92131 (6,636 at-risk, 0 sites within 5 km); 92021 (12,484 at-risk, 1 sites within 5 km); 92128 (12,407 at-risk, 1 sites within 5 km).

`ingest/search.ts "<place or zip>"` is the gap-fill process: it reports coverage for any place and, when there are fewer than 3 sites within 10 km, runs the whole pipeline for that place. 1 on-demand search(es) logged.

## Honest limits

- A page's hours are only as good as the page. Where two sources disagree we say so rather than choose.
- "Official" means listed by a government or county source. It does not mean every listed hour is current.
- Many sites have a single source; they are labeled as such and the agent should say "call ahead".
- Air-conditioning is stated only where a source says so (the county's Cool Zone definition) or reviews strongly suggest it; otherwise it is unknown.
