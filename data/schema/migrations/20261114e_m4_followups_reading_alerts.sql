-- M4: follow-ups held for Messenger after a voice call (send_sms), and alerts raised from our own readings.
-- Additive and idempotent.
alter type alert_kind add value if not exists 'high_heat_index';
alter type alert_kind add value if not exists 'high_aqi';

create table if not exists messenger_followups (
  id           serial primary key,
  phone_hash   text not null,
  body         text not null,
  site_id      int references sites,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  delivered_at timestamptz
);
create index if not exists messenger_followups_pending_idx on messenger_followups (phone_hash)
  where delivered_at is null;
