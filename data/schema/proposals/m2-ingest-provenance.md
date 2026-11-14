# Proposal (M2): provenance and change tracking for `sites`

**Status:** draft for review by all four members. It does not edit `schema.sql` or `types.ts`.
If approved, apply the SQL below to `schema.sql` and the types to `types.ts` in one PR, per the README.

## Why

The ingest pipeline produces more than the `sites` table can hold today, and the agent needs it to be honest on a call:

| Needed by | What | Why |
|---|---|---|
| M3 / M4 (agents) | `access_level`, `access_notes`, `requires_id`, `has_fee` | "Open to everyone" vs "students only" vs "60+" changes what the agent may recommend. |
| M3 / M4 (agents) | `verification`, `conflicts` | Say "open until 8" only when two sources agree; say "call ahead" when they disagree. |
| M1 (dashboard) | `verification`, source versions | Before/after coverage, "last changed" and data freshness. |
| Ingest | `maps_place_id` | Stable key for dedupe and re-crawls (no duplicate sites across runs). |
| Ingest | `source_page_versions` | Detect when a source page changes and keep an audit trail. |

Nothing here is required for the existing contracts to keep working. All new `sites` columns are nullable or defaulted.

## SQL

```sql
create type site_access as enum (
  'open_to_all', 'students_only', 'members_only', 'residents_only', 'age_restricted', 'unknown'
);
create type site_verification as enum (
  'confirmed',          -- 2+ independent sources agree on hours
  'conflict',           -- sources disagree; agent should say "call ahead"
  'single_source',      -- one source (e.g. Google Maps listing)
  'web_only'            -- only the site's own page
);

alter table sites
  add column access_level   site_access       not null default 'unknown',
  add column access_notes   text,                       -- e.g. 'Seniors 60+', 'Community borrowers welcome'
  add column requires_id    boolean,                    -- null = unknown
  add column has_fee        boolean,                    -- null = unknown
  add column verification   site_verification not null default 'single_source',
  add column conflicts      jsonb             not null default '[]',   -- human-readable disagreements
  add column evidence       text,                       -- verbatim quote from the source supporting hours/access
  add column source_urls    text[]            not null default '{}',   -- every source consulted
  add column maps_place_id  text unique,                -- Google Maps place id, for dedupe across runs
  add column pet_policy     text,                       -- county Cool Zone layer, e.g. 'Service Animals Only'
  add column official_name  text,                       -- name as the official listing writes it (name stays the short public name)
  add column ac_source      text;                       -- where has_ac comes from: official_program | site_page | reviews (null = unknown)

-- Written by: M2 (ingest). One row per fetch of a source page; a new content_hash means the page changed.
create table source_page_versions (
  id                 serial primary key,
  url                text        not null,
  fetched_at         timestamptz not null default now(),
  status             int         not null,            -- the target site's real HTTP status
  ok                 boolean     not null,
  content_hash       text,                            -- hash of normalized text; null when the fetch failed
  chars              int         not null default 0,
  error              text,
  blocked_by_policy  boolean     not null default false
);
create index on source_page_versions (url, fetched_at desc);
```

## Types (`types.ts`)

```ts
export type SiteAccess =
  | 'open_to_all' | 'students_only' | 'members_only' | 'residents_only' | 'age_restricted' | 'unknown';
export type SiteVerification = 'confirmed' | 'conflict' | 'single_source' | 'web_only';

// add to Site:
//   access_level: SiteAccess;
//   access_notes: string | null;
//   requires_id: boolean | null;
//   has_fee: boolean | null;
//   verification: SiteVerification;
//   conflicts: string[];
//   evidence: string | null;
//   source_urls: string[];
//   maps_place_id: string | null;
//   pet_policy: string | null;
//   official_name: string | null;
//   ac_source: 'official_program' | 'site_page' | 'reviews' | null;
```

## Ranking and agent behavior these enable (suggested, not part of this PR)

- `find_sites`: exclude `students_only` / `members_only` / `residents_only`; include `age_restricted` only when the caller fits.
- Agent wording by `verification`: `confirmed` states hours plainly; `single_source` / `web_only` adds "should be open, call ahead"; `conflict` says "hours differ between sources, please call".
- `hours_confirmed_on_source` stays as-is; ingest sets it true when `verification = 'confirmed'`.

## Interim

Until approved, ingest writes the extra fields to `data/seed/sites.extras.json`, keyed by site id, so nothing is lost and no one's code depends on them.
