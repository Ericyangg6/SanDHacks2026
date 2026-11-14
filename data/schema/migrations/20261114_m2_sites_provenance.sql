-- M2: provenance, access rules and stable keys for `sites`, plus source page versions and the ZIP gap analysis.
-- Additive and idempotent: safe to run more than once, and it never deletes or rewrites existing rows.
-- Approved by all four members. New databases get the same objects from schema.sql.

do $$ begin
  create type site_access as enum ('open_to_all', 'students_only', 'members_only', 'residents_only', 'age_restricted', 'unknown');
exception when duplicate_object then null; end $$;
do $$ begin
  create type site_verification as enum ('confirmed', 'conflict', 'single_source', 'web_only');
exception when duplicate_object then null; end $$;

alter table sites
  add column if not exists access_level   site_access       not null default 'unknown',
  add column if not exists access_notes   text,
  add column if not exists requires_id    boolean,
  add column if not exists has_fee        boolean,
  add column if not exists verification   site_verification not null default 'single_source',
  add column if not exists conflicts      jsonb             not null default '[]',
  add column if not exists evidence       text,
  add column if not exists source_urls    text[]            not null default '{}',
  add column if not exists maps_place_id  text,
  add column if not exists external_key   text,
  add column if not exists pet_policy     text,
  add column if not exists official_name  text,
  add column if not exists ac_source      text;
create unique index if not exists sites_external_key_key on sites (external_key);
create unique index if not exists sites_maps_place_id_key on sites (maps_place_id);

create table if not exists source_page_versions (
  id                 serial primary key,
  url                text        not null,
  fetched_at         timestamptz not null default now(),
  status             int         not null,
  ok                 boolean     not null,
  content_hash       text,
  chars              int         not null default 0,
  error              text,
  blocked_by_policy  boolean     not null default false
);
create index if not exists source_page_versions_url_idx on source_page_versions (url, fetched_at desc);

create table if not exists zip_gap (
  zip text primary key, name text, population int, age65plus int, households_no_vehicle int, below_poverty int,
  residents_at_risk int, sites_within_5km int, official_within_5km int, nearest_site_km real, nearest_site text,
  forecast_zone text, peak_temp_f real, peak_heat_index real, peak_time timestamptz, hours_90f_plus_72h int,
  heat_factor real, gap_score int, scenario_heat_index real, generated_at timestamptz
);
