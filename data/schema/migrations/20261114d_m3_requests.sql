-- M3: help requests. A caller asks for a pickup, a ride or a check; a dispatcher answers on the dashboard.
-- Additive and idempotent.
do $$ begin
  create type request_status as enum ('requesting', 'incoming', 'declined', 'closed');
exception when duplicate_object then null; end $$;
do $$ begin
  create type help_type as enum ('volunteer_pickup', 'ride_211', 'wellness_check');
exception when duplicate_object then null; end $$;

create table if not exists requests (
  id              serial primary key,
  conversation_id text unique,                -- ElevenLabs conversation; one request per call
  status          request_status not null default 'requesting',  -- changed only by dispatcher endpoints
  help_type       help_type,                  -- chosen by the dispatcher on accept
  said            text not null,              -- the caller's own words
  location        text not null,              -- where the caller said they are
  zip             text,
  lat             double precision,
  lon             double precision,
  needs           text[] not null default '{}',
  language        text,
  phone_e164      text,                       -- raw callback number while the request is open; null after decline or close
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists requests_status_created_at on requests (status, created_at);
