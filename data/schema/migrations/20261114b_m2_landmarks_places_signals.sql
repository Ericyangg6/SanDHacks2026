-- M2: location data for find_sites (so a caller can name a place instead of a ZIP) and review/news evidence.
-- Additive and idempotent. Written by M2 (ingest); read by find_sites (M3/M4 call it) and the dashboard (M1).

create table if not exists landmarks (
  id     serial primary key,
  name   text             not null,
  lat    double precision not null,
  lon    double precision not null,
  kind   text             not null,   -- OSM tag (library, hospital, building:university...), site:<kind> or maps:<category>
  weight int              not null    -- higher wins when names collide (our sites 5, Maps places 4, OSM detail 2, OSM county 1)
);
create index if not exists landmarks_lat_lon_idx on landmarks (lat, lon);

create table if not exists places (
  kind text             not null check (kind in ('zip', 'town')),
  key  text             not null,     -- zip code, or lower-case town / neighborhood name
  lat  double precision not null,
  lon  double precision not null,
  primary key (kind, key)
);

create table if not exists site_review_signals (
  maps_place_id   text primary key,
  site_id         int references sites (id) on delete set null,
  reviews_scanned int  not null,
  window_days     int  not null,
  ac_positive     int  not null default 0,
  ac_negative     int  not null default 0,
  crowded         int  not null default 0,
  spacious        int  not null default 0,
  quotes          jsonb not null default '[]',   -- verbatim review excerpts behind every count
  scanned_at      timestamptz not null
);
create index if not exists site_review_signals_site_idx on site_review_signals (site_id);

create table if not exists news_items (
  link       text primary key,
  title      text not null,
  source     text,
  date_text  text,                                -- as the news source writes it, e.g. "2 weeks ago"
  fetched_at timestamptz not null default now()
);
