-- M3: step-by-step trail of what happened on a call, shown to the dispatcher. Additive and idempotent.
-- No phone numbers. Events written before a help request exists carry the zip only, never the caller's stated location.
create table if not exists call_events (
  id              bigserial primary key,
  conversation_id text not null,              -- ElevenLabs conversation; joins requests.conversation_id
  at              timestamptz not null default now(),
  kind            text not null,              -- see types.ts: CallEventKind
  text            text not null               -- one short line for the dispatcher
);
create index if not exists call_events_conversation_at on call_events (conversation_id, at);
create unique index if not exists call_events_one_start on call_events (conversation_id) where kind = 'call_started';
