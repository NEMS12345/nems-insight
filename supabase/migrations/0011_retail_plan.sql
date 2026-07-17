-- 0011_retail_plan.sql
-- Per-NMI retail pricing. Retail contracts differ per metering point, so the retail plan is
-- stored per NMI and combined with the shared network tariff by the cost engine. When an NMI
-- has no plan, the report falls back to a labelled default.

create table retail_plan (
  id                 uuid primary key default gen_random_uuid(),
  metering_point_id  uuid not null,
  client_id          uuid not null,
  label              text,
  peak_rate          numeric(10, 6) not null,   -- $/kWh
  offpeak_rate       numeric(10, 6) not null,   -- $/kWh
  peak_start_hour    integer not null default 7,
  peak_end_hour      integer not null default 21,
  environmental_rate numeric(10, 6) not null default 0,
  market_rate        numeric(10, 6) not null default 0,
  supply_per_day     numeric(10, 5) not null default 0,
  metering_per_day   numeric(10, 5) not null default 0,
  created_by         uuid references auth.users (id),
  created_at         timestamptz not null default now(),
  unique (metering_point_id),
  foreign key (metering_point_id, client_id)
    references metering_point (id, client_id) on delete cascade
);

create index on retail_plan (client_id);

alter table retail_plan enable row level security;

create policy retail_plan_select on retail_plan
  for select using (can_access_client(client_id));
create policy retail_plan_write on retail_plan
  for all using (can_operate_client(client_id)) with check (can_operate_client(client_id));
