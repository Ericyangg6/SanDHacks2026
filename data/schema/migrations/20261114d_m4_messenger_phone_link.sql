-- M4: link a Messenger profile to a phone number (JOIN <zip> <phone> [name] on Messenger). Only the salted hash of
-- the number is stored, as in calls.phone_hash. Additive and idempotent.
alter table subscribers add column if not exists linked_phone_hash text;
alter table subscribers add column if not exists display_name text;
create index if not exists subscribers_linked_phone_hash_idx on subscribers (linked_phone_hash)
  where linked_phone_hash is not null;
