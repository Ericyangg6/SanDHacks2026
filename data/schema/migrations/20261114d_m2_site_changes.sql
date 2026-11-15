-- M2: the "what changed" feed. One row per detected change on a site's own page (hours changed, new closure),
-- written by ingest/daily-recrawl.ts, read by GET /m2/changes and the dashboard. Additive and idempotent.
create table if not exists site_changes (
  id          text primary key,              -- hash of (url, new content hash): re-running never duplicates
  detected_at timestamptz not null,
  kind        text not null check (kind in ('hours_changed', 'new_closure')),
  url         text not null,
  site_ids    int[] not null default '{}',
  site_names  text[] not null default '{}',
  summary     text not null,
  before      jsonb not null default '[]',   -- lines that disappeared from the page
  after       jsonb not null default '[]'    -- lines that appeared, verbatim
);
create index if not exists site_changes_detected_idx on site_changes (detected_at desc);
