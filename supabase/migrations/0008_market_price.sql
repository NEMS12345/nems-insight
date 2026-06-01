-- 0008_market_price.sql
-- Operator-entered market reference price (e.g. the ASX QLD base-load futures for the day).
-- Org-global by region — the same QLD futures figure benchmarks every QLD client. The
-- report reads the latest captured price; the retail benchmark is a hold point until one
-- is entered. (Licensed live feed can populate this same table later.)

create table market_price (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organisation (id) on delete cascade,
  region          text not null,                 -- e.g. 'QLD'
  futures_per_mwh numeric(10, 2) not null,
  captured_on     date not null default current_date,
  created_by      uuid references auth.users (id),
  created_at      timestamptz not null default now()
);

create index on market_price (org_id, region, captured_on desc);

alter table market_price enable row level security;

create policy market_price_select on market_price
  for select using (is_org_operator(org_id));
create policy market_price_write on market_price
  for all using (is_org_operator(org_id)) with check (is_org_operator(org_id));
