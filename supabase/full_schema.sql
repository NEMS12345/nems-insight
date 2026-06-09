-- NEMS Insight — full schema (all migrations combined). Paste into Supabase SQL Editor.
-- Fresh project only. auth.users / auth.uid() are provided by Supabase.

-- ============================================================
-- 0001_initial_schema.sql
-- ============================================================
-- 0001_initial_schema.sql
-- NEMS Insight — Phase 1: data foundation (hierarchy + multi-tenant RLS).
--
-- Hierarchy: organisation -> client (portfolio) -> site -> metering_point (NMI).
-- Interval data, import_batch and raw_file arrive in Phase 2 (ingestion).
--
-- Multi-tenancy is built in NOW even though only operators log in for v1 (see CLAUDE.md §3):
--   * every client-owned row carries client_id,
--   * composite foreign keys guarantee client_id stays consistent down the hierarchy,
--   * Row-Level Security enforces "see only what you're allowed to" at the database.
-- v1 operators get a role that sees ALL clients in their org. The read-only client view
-- and a future self-serve tier are just NARROWER roles on these SAME policies.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type member_role   as enum ('operator', 'client_viewer');
create type client_status as enum ('active', 'prospect', 'archived');
create type meter_type    as enum ('nmi_parent');  -- kept general; v1 = NMI/parent only

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- The operator organisation running the managed service.
create table organisation (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

-- Which auth user belongs to which organisation, and in what role.
-- (auth.users is Supabase's built-in auth table.)
create table org_member (
  user_id     uuid not null references auth.users (id) on delete cascade,
  org_id      uuid not null references organisation (id) on delete cascade,
  role        member_role not null default 'operator',
  created_at  timestamptz not null default now(),
  primary key (user_id, org_id)
);

-- A customer business — the portfolio. This is the tenancy boundary.
create table client (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organisation (id) on delete cascade,
  name        text not null,
  abn         text,
  status      client_status not null default 'prospect',
  created_at  timestamptz not null default now(),
  unique (id, org_id)            -- supports composite FKs / org-scoped integrity
);

-- A client_viewer's access to specific clients. Unused in v1 (operators see all),
-- but the structure is here so the read-only client view and self-serve bolt on later.
create table client_access (
  user_id     uuid not null references auth.users (id) on delete cascade,
  client_id   uuid not null references client (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, client_id)
);

-- A physical premises belonging to a client.
create table site (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null,
  name        text not null,
  address     text,
  state       text,             -- AU state/territory, e.g. 'QLD'
  network     text,             -- DNSP, e.g. 'Energex'
  created_at  timestamptz not null default now(),
  unique (id, client_id),
  foreign key (client_id) references client (id) on delete cascade
);

-- A metering point. v1 = an NMI / parent meter. meter_type stays general so other
-- meter types can be added later without reshaping the model.
-- The composite FK (site_id, client_id) -> site(id, client_id) GUARANTEES a metering
-- point's client_id always matches its site's client_id — tenancy can't drift.
create table metering_point (
  id          uuid primary key default gen_random_uuid(),
  site_id     uuid not null,
  client_id   uuid not null,
  nmi         text not null,
  meter_type  meter_type not null default 'nmi_parent',
  created_at  timestamptz not null default now(),
  unique (id, client_id),
  unique (client_id, nmi),
  foreign key (site_id, client_id) references site (id, client_id) on delete cascade
);

create index on site (client_id);
create index on metering_point (site_id);
create index on metering_point (client_id);

-- ---------------------------------------------------------------------------
-- Access helper functions (SECURITY DEFINER so they don't recurse through RLS)
-- ---------------------------------------------------------------------------

-- Is the current user an operator in this organisation?
create or replace function is_org_operator(p_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from org_member m
    where m.user_id = auth.uid()
      and m.org_id  = p_org_id
      and m.role    = 'operator'
  );
$$;

-- Is the current user an operator for the org that owns this client?
create or replace function can_operate_client(p_client_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from org_member m
    join client c on c.org_id = m.org_id
    where m.user_id = auth.uid()
      and c.id      = p_client_id
      and m.role    = 'operator'
  );
$$;

-- Can the current user READ this client? Operator on its org, OR an explicit viewer.
create or replace function can_access_client(p_client_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select can_operate_client(p_client_id)
      or exists (
        select 1 from client_access ca
        where ca.user_id = auth.uid()
          and ca.client_id = p_client_id
      );
$$;

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- Reads are gated by can_access_client (operators + viewers).
-- Writes are gated by can_operate_client / is_org_operator (operators only) — this is
-- what makes the client view inherently read-only.
-- ---------------------------------------------------------------------------

alter table organisation   enable row level security;
alter table org_member     enable row level security;
alter table client         enable row level security;
alter table client_access  enable row level security;
alter table site           enable row level security;
alter table metering_point enable row level security;

-- organisation: a member can see their own org.
create policy organisation_select on organisation
  for select using (
    exists (
      select 1 from org_member m
      where m.user_id = auth.uid() and m.org_id = organisation.id
    )
  );

-- org_member: a user can see their own memberships. (Membership is provisioned by
-- admin/seed via the service role, which bypasses RLS.)
create policy org_member_select on org_member
  for select using (user_id = auth.uid());

-- client
create policy client_select on client
  for select using (can_access_client(id));
create policy client_insert on client
  for insert with check (is_org_operator(org_id));
create policy client_update on client
  for update using (can_operate_client(id)) with check (is_org_operator(org_id));
create policy client_delete on client
  for delete using (can_operate_client(id));

-- client_access: visible to the user it grants, or to operators of that client.
create policy client_access_select on client_access
  for select using (user_id = auth.uid() or can_operate_client(client_id));
create policy client_access_write on client_access
  for all using (can_operate_client(client_id)) with check (can_operate_client(client_id));

-- site
create policy site_select on site
  for select using (can_access_client(client_id));
create policy site_insert on site
  for insert with check (can_operate_client(client_id));
create policy site_update on site
  for update using (can_operate_client(client_id)) with check (can_operate_client(client_id));
create policy site_delete on site
  for delete using (can_operate_client(client_id));

-- metering_point
create policy metering_point_select on metering_point
  for select using (can_access_client(client_id));
create policy metering_point_insert on metering_point
  for insert with check (can_operate_client(client_id));
create policy metering_point_update on metering_point
  for update using (can_operate_client(client_id)) with check (can_operate_client(client_id));
create policy metering_point_delete on metering_point
  for delete using (can_operate_client(client_id));

-- ============================================================
-- 0002_ingestion.sql
-- ============================================================
-- 0002_ingestion.sql
-- NEMS Insight — Phase 2: ingestion tables (interval data + audit trail + raw files).
--
-- Same tenancy discipline as Phase 1: every row carries client_id, composite FKs keep it
-- consistent with the hierarchy, and RLS gates reads (operators + viewers) vs writes
-- (operators only). interval_reading is keyed by (metering_point, channel, interval_start)
-- because a metering point reports multiple channels (E/B/Q) per interval.

-- Quality labels mirror the NEM12 codes (A/S/F/E/N) but use the readable domain names so
-- the stored value matches core's QualityFlag exactly — no lossy mapping.
create type quality_flag as enum (
  'actual',            -- A
  'substituted',       -- S
  'final-substituted', -- F
  'estimated',         -- E
  'null'               -- N (no data)
);

-- The original uploaded file, kept verbatim (bytes live in Supabase Storage; this row is
-- the metadata + pointer) so we can always re-parse from source.
create table raw_file (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references client (id) on delete cascade,
  storage_path  text not null,           -- path within the private 'raw-files' bucket
  filename      text not null,
  content_type  text,
  byte_size     bigint,
  sha256        text,
  uploaded_by   uuid references auth.users (id),
  uploaded_at   timestamptz not null default now()
);

-- One row per uploaded file: the import audit trail.
create table import_batch (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references client (id) on delete cascade,
  raw_file_id    uuid references raw_file (id) on delete set null,
  filename       text,
  format         text not null default 'NEM12',
  status         text not null default 'pending',  -- pending | parsed | partial | failed
  uploaded_by    uuid references auth.users (id),
  uploaded_at    timestamptz not null default now(),
  reading_count  integer not null default 0,
  error_count    integer not null default 0,
  warning_count  integer not null default 0,
  errors         jsonb not null default '[]'::jsonb,
  warnings       jsonb not null default '[]'::jsonb
);

-- The interval time-series.
create table interval_reading (
  id               bigint generated always as identity primary key,
  client_id        uuid not null,
  metering_point_id uuid not null,
  channel          text not null,            -- NMI suffix, e.g. E1 / B1 / Q1
  interval_start   timestamptz not null,
  interval_length  smallint not null,        -- minutes
  value            double precision not null,
  unit             text not null,            -- 'kWh' | 'kVArh'
  quality          quality_flag not null,
  import_batch_id  uuid references import_batch (id) on delete set null,
  created_at       timestamptz not null default now(),
  -- Composite FK guarantees a reading's client_id matches its metering point's client_id.
  foreign key (metering_point_id, client_id)
    references metering_point (id, client_id) on delete cascade,
  -- Natural key: one value per metering point + channel + interval (supports re-import upsert).
  unique (metering_point_id, channel, interval_start)
);

create index on raw_file (client_id);
create index on import_batch (client_id);
create index on interval_reading (client_id);
create index on interval_reading (import_batch_id);

-- ---------------------------------------------------------------------------
-- Row-Level Security (same pattern as Phase 1)
-- ---------------------------------------------------------------------------
alter table raw_file         enable row level security;
alter table import_batch     enable row level security;
alter table interval_reading enable row level security;

create policy raw_file_select on raw_file
  for select using (can_access_client(client_id));
create policy raw_file_write on raw_file
  for all using (can_operate_client(client_id)) with check (can_operate_client(client_id));

create policy import_batch_select on import_batch
  for select using (can_access_client(client_id));
create policy import_batch_write on import_batch
  for all using (can_operate_client(client_id)) with check (can_operate_client(client_id));

create policy interval_reading_select on interval_reading
  for select using (can_access_client(client_id));
create policy interval_reading_write on interval_reading
  for all using (can_operate_client(client_id)) with check (can_operate_client(client_id));

-- ============================================================
-- 0003_rollups.sql
-- ============================================================
-- 0003_rollups.sql
-- NEMS Insight — Phase 5: energy rollup views for portfolio -> site -> NMI aggregation.
--
-- These views aggregate interval_reading energy at each level of the hierarchy so the
-- portfolio/client/site pages can show totals without pulling every interval row.
--
-- WITH (security_invoker = true): the views run as the QUERYING user, so the existing
-- Row-Level Security on metering_point and interval_reading still applies — an operator
-- only ever rolls up their own clients' data. (Postgres 15+, which Supabase runs.)
--
-- Energy classification mirrors core's channelKind(): E* = import (consumption),
-- B* = export. Reactive (Q*) is excluded from energy totals.

create view metering_point_energy with (security_invoker = true) as
  select
    mp.id        as metering_point_id,
    mp.site_id   as site_id,
    mp.client_id as client_id,
    mp.nmi       as nmi,
    coalesce(sum(ir.value) filter (where left(ir.channel, 1) = 'E'), 0) as import_kwh,
    coalesce(sum(ir.value) filter (where left(ir.channel, 1) = 'B'), 0) as export_kwh,
    count(ir.id) as reading_count
  from metering_point mp
  left join interval_reading ir on ir.metering_point_id = mp.id
  group by mp.id, mp.site_id, mp.client_id, mp.nmi;

create view site_energy with (security_invoker = true) as
  select
    site_id,
    client_id,
    sum(import_kwh)     as import_kwh,
    sum(export_kwh)     as export_kwh,
    sum(reading_count)  as reading_count
  from metering_point_energy
  group by site_id, client_id;

create view client_energy with (security_invoker = true) as
  select
    client_id,
    sum(import_kwh)     as import_kwh,
    sum(export_kwh)     as export_kwh,
    sum(reading_count)  as reading_count
  from site_energy
  group by client_id;

-- ============================================================
-- 0004_bills.sql
-- ============================================================
-- 0004_bills.sql
-- NEMS Insight — Phase 4: structured bill capture (for reconciliation against modelled cost).
--
-- The operator enters a bill's facts via a form (NOT automated PDF parsing): retailer,
-- tariff, period, billed total, and optional line items. The original PDF can be attached
-- via raw_file. Amounts are stored EX-GST to compare like-for-like with the modelled cost.
--
-- Same tenancy discipline as the rest of the schema: client_id on every row, composite FK
-- so a bill's NMI can't belong to another client, and RLS (operators write, viewers read).

create table bill (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null,
  metering_point_id uuid not null,
  retailer          text,
  tariff_code       text,                 -- network tariff code, e.g. '7200'
  tariff_name       text,
  period_start      date not null,
  period_end        date not null,
  billed_total      numeric(12, 2) not null,  -- ex-GST
  notes             text,
  raw_file_id       uuid references raw_file (id) on delete set null,
  created_by        uuid references auth.users (id),
  created_at        timestamptz not null default now(),
  foreign key (metering_point_id, client_id)
    references metering_point (id, client_id) on delete cascade
);

create table bill_line_item (
  id        uuid primary key default gen_random_uuid(),
  bill_id   uuid not null references bill (id) on delete cascade,
  client_id uuid not null references client (id) on delete cascade,
  label     text not null,
  category  text,                         -- 'network' | 'retail' | other
  amount    numeric(12, 2) not null       -- ex-GST
);

create index on bill (metering_point_id);
create index on bill (client_id);
create index on bill_line_item (bill_id);

alter table bill           enable row level security;
alter table bill_line_item enable row level security;

create policy bill_select on bill
  for select using (can_access_client(client_id));
create policy bill_write on bill
  for all using (can_operate_client(client_id)) with check (can_operate_client(client_id));

create policy bill_line_item_select on bill_line_item
  for select using (can_access_client(client_id));
create policy bill_line_item_write on bill_line_item
  for all using (can_operate_client(client_id)) with check (can_operate_client(client_id));

-- ============================================================
-- 0005_meter_serial.sql
-- ============================================================
-- 0005_meter_serial.sql
-- NEMS Insight — support data sources that identify individual meters under one NMI
-- (e.g. the tabular "30-minute meter profile" export). Each meter serial is its own
-- metering point. This is a general extension of "metering point" — NOT parent/child
-- sub-metering or allocation (still out of scope).

alter table metering_point add column meter_serial text;

-- The old "one metering point per (client, NMI)" rule no longer holds: an NMI can have
-- several meters. Uniqueness becomes (client, NMI, meter_serial), treating a missing
-- serial (NEM12, which has no per-meter id) as a single empty-string slot.
alter table metering_point drop constraint if exists metering_point_client_id_nmi_key;

create unique index metering_point_client_nmi_serial_key
  on metering_point (client_id, nmi, coalesce(meter_serial, ''));

-- ============================================================
-- 0006_metering_point_tariff.sql
-- ============================================================
-- 0006_metering_point_tariff.sql
-- Different NMIs sit on different network tariffs (e.g. a SAC Large warehouse on 7200, a
-- CAC HV office tower on 7400). Record the network tariff code per metering point so the
-- cost engine models each NMI on the right tariff.

alter table metering_point add column tariff_code text;

-- ============================================================
-- 0007_loss_factors.sql
-- ============================================================
-- 0007_loss_factors.sql
-- Loss factors are NMI/location-specific and scale energy charges on the bill
-- (MLF = marginal/transmission loss factor, DLF = distribution loss factor).
-- Stored per metering point and applied explicitly by the cost engine.

alter table metering_point add column mlf numeric(8, 5);
alter table metering_point add column dlf numeric(8, 5);

-- ============================================================
-- 0008_market_price.sql
-- ============================================================
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

-- ============================================================
-- 0009_site_floor_area.sql
-- ============================================================
-- 0009_site_floor_area.sql
-- Optional floor area per site, to report energy intensity (kWh/m²) — a common C&I
-- benchmarking metric. Optional: the report shows intensity only when it's set.

alter table site add column floor_area_m2 numeric(10, 1);

-- ============================================================
-- 0010_emissions_factor.sql
-- ============================================================
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

-- ============================================================
-- 0011_retail_plan.sql
-- ============================================================
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

-- ============================================================
-- 0012_nmi_voltage_pf.sql
-- ============================================================
-- 0012_nmi_voltage_pf.sql
-- Per-NMI connection voltage (eligibility) and an optional assumed power factor.
--   connection_voltage: 'LV' | 'HV' — a physical constraint on which tariffs apply. When
--     null, the report must not offer cross-voltage tariff alternatives.
--   assumed_pf: used only when the data has no reactive channel and a kVA-demand tariff is
--     being assessed; never defaults to 1.0.

alter table metering_point add column connection_voltage text;  -- 'LV' | 'HV'
alter table metering_point add column assumed_pf numeric(4, 3);


-- ============================================================
-- 0013_site_timezone.sql
-- ============================================================
-- 0013_site_timezone.sql
-- IANA timezone per site, e.g. 'Australia/Brisbane'. Time-of-use windows are evaluated in
-- the site's LOCAL clock time (see CLAUDE.md §5 + src/core/time), so the analytics/cost
-- engine needs to know each site's zone to bucket intervals correctly across daylight
-- saving. Optional: when absent the app falls back to NEM time (AEST, UTC+10), which is
-- correct for SE QLD / Energex sites (QLD does not observe DST) — the v1 scope.

alter table site add column timezone text;
