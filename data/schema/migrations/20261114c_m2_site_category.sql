-- M2: keep the place's category (Google Maps / source), e.g. "Cafe", "Public library". find_sites uses it to allow cafes
-- (free to sit in, but staff may expect a purchase) and to word the summary honestly. Additive and idempotent.
alter table sites add column if not exists category text;
