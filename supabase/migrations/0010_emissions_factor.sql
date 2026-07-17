-- 0010_emissions_factor.sql
-- Operator-editable NGA Scope 2 emissions factor override (per region/state). NGA factors
-- are published annually and trend down, so operators can keep this current. When unset,
-- the report falls back to the cited built-in default (so emissions still compute).

create table emissions_factor (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organisation (id) on delete cascade,
  region           text not null,                 -- AU state, e.g. 'QLD'
  factor_t_per_mwh numeric(8, 5) not null,
  nga_year         text,                          -- e.g. 'NGA 2024'
  created_by       uuid references auth.users (id),
  created_at       timestamptz not null default now()
);

create index on emissions_factor (org_id, region, created_at desc);

alter table emissions_factor enable row level security;

create policy emissions_factor_select on emissions_factor
  for select using (is_org_operator(org_id));
create policy emissions_factor_write on emissions_factor
  for all using (is_org_operator(org_id)) with check (is_org_operator(org_id));
