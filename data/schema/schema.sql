-- Shade: Neon Postgres schema (source of truth).
-- Changes go through a PR that all four members review. See README.md.

create type site_kind as enum (
  'cool_zone', 'library', 'rec_center', 'community_center', 'senior_center', 'mall', 'other'
);
create type site_tier as enum ('official', 'discovered');
create type call_direction as enum ('inbound', 'outbound');
create type channel as enum ('voice', 'sms');
create type call_outcome as enum (
  'site_given', 'sms_sent', 'no_site_found', 'escalated_911', 'abandoned', 'error'
);
create type alert_kind as enum ('extreme_heat_warning', 'heat_advisory', 'air_quality_alert', 'mock');
create type reading_source as enum ('airnow', 'nws', 'purpleair', 'mock');

-- Written by: M2 (ingest). Read by: everyone.
create table sites (
  id               serial primary key,
  name             text not null,
  kind             site_kind not null,
  tier             site_tier not null,
  confidence       real check (confidence between 0 and 1),  -- Gemini extraction confidence; null for official
  address          text not null,
  zip              text,
  lat              double precision not null,
  lon              double precision not null,
  hours            jsonb not null,                           -- see types.ts: SiteHours
  hours_confirmed_on_source boolean not null default false,  -- today's hours found on the site's own page
  has_ac           boolean,                                  -- null = unknown
  has_filtration   boolean,                                  -- null = unknown; true only if a source says so
  capacity_est     int,
  phone            text,
  source_url       text not null,
  last_verified_at timestamptz not null,
  created_at       timestamptz not null default now()
);
create index on sites (zip);
create index on sites (lat, lon);

-- Written by: M4 (opt-in / STOP handling). Read by: M4, M1 (aggregates only).
create table subscribers (
  id          serial primary key,
  phone_hash  text unique not null,       -- sha256(salt + e164); never store raw numbers here
  language    text not null default 'en', -- en | es | tl | vi | zh
  zip         text not null,
  needs       jsonb not null default '{}',-- see types.ts: CallerNeeds
  consent_at  timestamptz not null,
  opted_out_at timestamptz
);
create index on subscribers (zip) where opted_out_at is null;

-- Written by: M3 (inbound voice), M4 (outbound + sms). Read by: M1, ranking.
create table calls (
  id          serial primary key,
  direction   call_direction not null,
  channel     channel not null,
  phone_hash  text,
  zip         text,
  language    text,
  site_id     int references sites,
  outcome     call_outcome,
  alert_id    int,                         -- set for outbound texts triggered by an alert (fk added below)
  started_at  timestamptz not null default now(),
  ended_at    timestamptz
);
create index on calls (site_id, started_at desc);  -- recent_referrals()
create index on calls (zip, started_at desc);

-- Written by: M2 (AirNow/NWS pollers). Read by: M1, ranking, M3/M4 for AQI in replies.
create table readings (
  time       timestamptz not null,
  zip        text not null,
  temp_f     real,
  heat_index real,
  aqi        int,
  source     reading_source not null
);
create index on readings (zip, time desc);

-- Written by: M4 (alert workflow). Read by: M1, M2 (re-crawl trigger).
create table alerts (
  id          serial primary key,
  kind        alert_kind not null,
  nws_id      text unique,                 -- null for mock alerts
  zips        text[] not null,
  headline    text,
  onset_at    timestamptz,
  expires_at  timestamptz,
  detected_at timestamptz not null default now(),
  texts_sent  int not null default 0
);
alter table calls add foreign key (alert_id) references alerts (id);

-- Written by: M4 (text agent memory). Read by: M4.
create table messages (
  id          serial primary key,
  phone_hash  text not null,
  role        text not null check (role in ('user', 'assistant')),
  body        text not null,
  created_at  timestamptz not null default now()
);
create index on messages (phone_hash, created_at desc);
