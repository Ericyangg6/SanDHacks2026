# Data evidence

*Generated 2026-11-15 05:04 UTC by `ingest/report.ts`. Every number below is computed from the pipeline's logs, caches, git history and seed files, not typed in. Re-run it to refresh.*

## What this is

A maintained, verified dataset of free public cooling spaces in San Diego County, built from the open web. No unified list existed: the county's Cool Zones live in a PDF and a map layer, libraries and rec centers on separate city pages, and nothing says who may enter or whether hours are current.

## Coverage

| | |
|---|---|
| Sites in the seed | 563 |
| Official (published by a government or county source) | 120 |
| Discovered (found on the open web) | 443 |
| ZIP codes covered | 93 |
| Hours confirmed by two independent sources | 49 |
| Source disagreements flagged (call ahead) | 16 |
| Sites with capacity known | 80 |
| Stated as open to everyone | 107 |
| Access restricted (age, members, students) | 4 |

By type: library 102, rec_center 132, senior_center 37, mall 22, community_center 53, other 217.

### Growth (from git history of `data/seed/sites.json`)

| When | Commit | Sites | Change |
|---|---|---|---|
| Nov 14 12:59 | `dc00068` | 67 | Add seed snapshot, schema proposal and Neon branch loader |
| Nov 14 13:38 | `3f7f907` | 138 | Add official county Cool Zones source, sorted seed and richer verifica |
| Nov 14 14:05 | `146d2e8` | 149 | Add on-demand search, extraction cache, matching fix and 149-site seed |
| Nov 14 15:20 | `6c3baf5` | 271 | entire backend help |
| Nov 14 15:42 | `eafca3f` | 271 | Adopt M2 schema additions; production-safe loader; stable site ids; ca |
| Nov 14 16:45 | `7cfb508` | 411 | Add campus / La Jolla data (411 sites); keep ids stable when a place's |

## How the data was collected

| | |
|---|---|
| Search-result pages cached (Bright Data SERP) | 550 |
| Web pages cached | 1101 |
| Page fetches recorded in the version log | 2002 |
| Distinct URLs fetched | 1334 |
| Fetches that succeeded (target returned content) | 1197 (60%) |
| Fetches refused by Bright Data's policy (government domains) | 277 |
| Government-domain pages fetched successfully (served by a second fetcher, since Bright Data refuses .gov) | 256 |
| Fetches that failed for other reasons | 528 (target statuses: 0×143, 200×205, 402×9, 403×14, 429×10, 502×147) |
| Google Maps places (Bright Data Maps scraper) | 782 |
| Pages whose content changed between fetches | 25 |

**A real scraping problem we handled.** Bright Data's Web Unlocker answers HTTP 200 even when the target site failed or the domain is refused. We request the JSON envelope and read the *target's* real status and the `x-brd-error` header, so a refusal is detected and logged instead of being mistaken for an empty page. Government domains are refused by policy; 277 such fetches are in the log, and those pages are routed to a second fetcher.

**Search results sometimes carry only redirect links.** About 60% of Google results come back as opaque redirects. We rebuild the real URL from the visible address when it is complete and drop the result otherwise, so nothing is guessed.

## Verification: nothing the model says is trusted on its own

Every extracted site must carry a quote copied from the source page, and the code checks that the quote appears verbatim in the page text.

| | |
|---|---|
| Records the extractor produced | 795 |
| Passed the verbatim-quote check | 763 (96%) |
| Rejected (quote not found in the source) | 32 (4%) |

Hours from the site's own page are then compared, in code, against Google Maps hours: they agree within 30 minutes, or the site is flagged. That comparison is deterministic and auditable, so no model decides whether two sources agree.

### Disagreements caught

- **Alpine Library Friends Association**: thu: maps 10:00-16:30 vs web 10:00-18:00; wed: maps 10:00-16:30 vs web 10:00-18:00
- **Montevalle Recreation Center**: sat: maps 09:00-12:00 vs web 09:00-13:00; fri: maps 09:00-19:45 vs web 13:00-18:00
- **San Diego County Library – Del Mar Branch**: tue: maps 12:00-19:00 vs web 00:00-19:00
- **La Jolla Recreation Center**: sat: maps 09:00-15:00 vs web 10:00-14:00; fri: maps 10:00-19:00 vs web 12:00-18:00
- **Lakeside Community Center**: thu: maps 12:00-20:00 vs web 10:00-18:00; wed: maps 12:00-20:00 vs web 10:00-18:00
- **San Diego County Library – Lakeside**: fri: maps 10:00-17:00 vs web 09:00-20:00; thu: maps 10:00-18:00 vs web 09:00-20:00

### Evidence quotes, examples

- **San Diego County Library – Bonita-Sunnyside Branch** (91902): "Mon 10:00am-6:00pm ... Sat 10:00am-5:00pm"
- **Chula Vista Public Library Civic Center Branch** (91910): "Mon 10:00am-8:00pm ... Sun 1:00pm-5:00pm"
- **Parkway Aquatic Center** (91910): "8:00am- 2:00pm / 4:00pm- 7:00pm ... 8:00am- 2:00pm"
- **South Chula Vista Library** (91911): "Mon 10:00am-8:00pm ... Sun 1:00pm-5:00pm"

## The data keeps itself current

Every fetch is recorded with a content hash. A new hash means the page changed, and the added and removed lines are stored. 25 page(s) have changed between fetches so far. Re-running `./ingest/run-all.sh --refresh` re-checks every page, and `ingest/alert-refresh.ts` does the same for the ZIPs in a forecast zone when the National Weather Service issues a heat or air-quality alert.

## Where coverage is thin (and the process for it)

The cooling-gap analysis combines the NWS hourly forecast, Census residents who are 65+ or live in households without a vehicle, and the number of sites within 5 km of each ZIP.

| | |
|---|---|
| San Diego County ZIPs analyzed | 111 |
| Populated ZIPs with no site within 5 km | 8 |
| At-risk residents in those ZIPs | 8,352 |

Worst served: 92040 (8,079 at-risk, 1 sites within 5 km); 92027 (8,018 at-risk, 1 sites within 5 km); 92028 (10,563 at-risk, 2 sites within 5 km); 92057 (9,490 at-risk, 2 sites within 5 km); 92026 (10,107 at-risk, 3 sites within 5 km).

`ingest/search.ts "<place or zip>"` is the gap-fill process: it reports coverage for any place and, when there are fewer than 3 sites within 10 km, runs the whole pipeline for that place. 7 on-demand search(es) logged.

## Honest limits

- A page's hours are only as good as the page. Where two sources disagree we say so rather than choose.
- "Official" means listed by a government or county source. It does not mean every listed hour is current.
- Many sites have a single source; they are labeled as such and the agent should say "call ahead".
- Air-conditioning is stated only where a source says so (the county's Cool Zone definition) or reviews strongly suggest it; otherwise it is unknown.
