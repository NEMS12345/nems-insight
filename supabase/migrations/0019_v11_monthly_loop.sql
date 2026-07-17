-- 0019_v11_monthly_loop.sql
-- [v1.1] The monthly managed-service loop (CLAUDE.md §5b): editable tariff/contract records,
-- per-NMI assignment, persisted reconciliation runs + findings, recovery pipeline, and the
-- ingestion quality gate. All client-owned tables carry client_id NOT NULL with composite FKs.
--
-- Versioning model: an assignment binds an NMI to a tariff CODE and a contract GROUP (not a
-- specific version row), so a bill is still priced on the rate-set version effective during
-- its period — adding next year's rates is a new dated row, never a re-assignment.

-- ------------------------------------------------------------------
-- network_tariff — one dated DNSP rate-set version. ORG-level reference data (not client-owned):
-- tariffs are published DNSP facts shared across the portfolio.
-- `rates` is the pure engine `Tariff` object (src/core/tariff/types.ts) as JSON; a vitest
-- drift-lock (tests/core/tariff-seed-drift.test.ts) keeps the seeded JSON equal to the code
-- registry so the two sources can never diverge silently.
-- ------------------------------------------------------------------
create table network_tariff (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organisation (id) on delete cascade,
  code           text not null,
  name           text not null,
  dnsp           text not null default 'Energex',
  effective_from date not null default date '2000-01-01',
  rates          jsonb not null,
  source_note    text,
  created_by     uuid references auth.users (id),
  created_at     timestamptz not null default now(),
  unique (org_id, code, effective_from)
);

alter table network_tariff enable row level security;
create policy network_tariff_select on network_tariff
  for select using (is_org_operator(org_id));
create policy network_tariff_write on network_tariff
  for all using (is_org_operator(org_id)) with check (is_org_operator(org_id));

-- Seed the invoice-derived Energex versions for every existing organisation. Superseded,
-- never edited in place, once used by a reconciliation (working norm, enforced by review).
insert into network_tariff (org_id, code, name, dnsp, effective_from, rates, source_note)
select o.id, t.code, t.name, 'Energex', t.effective_from, t.rates, t.source_note
from organisation o
cross join (values
  ('7200', 'Energex 7200 (SAC Large TOU)', date '2026-07-01',
   '{"code":"7200","name":"Energex 7200 (SAC Large TOU)","network":"Energex","currency":"AUD","voltageClass":"LV","eligibility":{"minAnnualMwh":100},"hasEstimatedCharges":false,"effectiveFrom":"2026-07-01","periods":{"peak":{"dayTypes":["weekday"],"ranges":[{"startMin":1020,"endMin":1200}]},"offpeak":{"dayTypes":["weekday","weekend"],"ranges":[{"startMin":660,"endMin":780}]}},"charges":[{"kind":"fixed_daily","category":"network","label":"Network fixed charge","ratePerDay":9.257},{"kind":"energy","category":"network","label":"Network energy (peak)","period":"peak","rate":0.01876},{"kind":"energy","category":"network","label":"Network energy (shoulder)","period":"shoulder","rate":0.02947},{"kind":"energy","category":"network","label":"Network energy (off-peak)","period":"offpeak","rate":0.01627},{"kind":"demand_monthly","category":"network","label":"Network demand (peak)","period":"peak","unit":"kW","rate":15.459},{"kind":"demand_monthly","category":"network","label":"Network demand (shoulder)","period":"shoulder","unit":"kW","rate":4.08}]}'::jsonb,
   'Energex NUOS 2026-27 published rates (see src/core/tariff/energex.ts)'),
  ('7400', 'Energex 7400 (11kV TOU Demand)', date '2025-07-01',
   '{"code":"7400","name":"Energex 7400 (11kV TOU Demand)","network":"Energex","currency":"AUD","voltageClass":"HV","hasEstimatedCharges":false,"effectiveFrom":"2025-07-01","periods":{"peak":{"dayTypes":["weekday"],"ranges":[{"startMin":540,"endMin":1260}]},"offpeak":{"dayTypes":[],"ranges":[]}},"charges":[{"kind":"fixed_daily","category":"network","label":"Network access (DUOS)","ratePerDay":22.306},{"kind":"fixed_daily","category":"network","label":"Jurisdictional scheme (fixed)","ratePerDay":0.573},{"kind":"connection_unit","category":"network","label":"DUOS connection unit charge","ratePerUnit":245.582},{"kind":"energy","category":"network","label":"Network volume (DUOS+TUOS+JS)","period":"all","rate":0.01974},{"kind":"demand_monthly","category":"network","label":"Network peak demand (DUOS+TUOS)","period":"peak","unit":"kVA","rate":11.011}]}'::jsonb,
   'Derived from Origin invoice QB04077571 (Mar 2026, 2025-26 FY rates)')
) as t(code, name, effective_from, rates, source_note);

-- ------------------------------------------------------------------
-- retail_contract — one dated retail rate-set version for a client. Versions of the same
-- contract share group_id; an assignment points at the group, and the version effective
-- during a bill's period is picked at costing time (pickEffective semantics).
-- `rates` is the pure `RetailPlan` object (src/core/tariff/retail.ts) as JSON.
-- ------------------------------------------------------------------
create table retail_contract (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references client (id) on delete cascade,
  group_id       uuid not null default gen_random_uuid(),
  retailer       text,
  label          text,
  effective_from date not null default date '2000-01-01',
  rates          jsonb not null,
  raw_file_id    uuid references raw_file (id) on delete set null,
  created_by     uuid references auth.users (id),
  created_at     timestamptz not null default now(),
  unique (id, client_id),
  unique (group_id, effective_from)
);
create index on retail_contract (client_id);
create index on retail_contract (group_id);

alter table retail_contract enable row level security;
create policy retail_contract_select on retail_contract
  for select using (can_access_client(client_id));
create policy retail_contract_write on retail_contract
  for all using (can_operate_client(client_id)) with check (can_operate_client(client_id));

-- Migrate retail_plan rows across: each NMI's dated plan versions become one contract group.
with plan_groups as (
  select distinct metering_point_id, gen_random_uuid() as gid
  from retail_plan
)
insert into retail_contract (client_id, group_id, retailer, label, effective_from, rates, created_by, created_at)
select
  rp.client_id,
  pg.gid,
  null,
  coalesce(rp.label, 'Migrated retail plan'),
  rp.effective_from,
  jsonb_build_object(
    'label', coalesce(rp.label, 'Retail plan'),
    'peakRatePerKwh', rp.peak_rate,
    'offpeakRatePerKwh', rp.offpeak_rate,
    'peakWindow', jsonb_build_object(
      'dayTypes', jsonb_build_array('weekday'),
      'ranges', jsonb_build_array(jsonb_build_object(
        'startMin', rp.peak_start_hour * 60, 'endMin', rp.peak_end_hour * 60))),
    'environmentalPerKwh', rp.environmental_rate,
    'marketPerKwh', rp.market_rate,
    'supplyPerDay', rp.supply_per_day,
    'meteringPerDay', rp.metering_per_day,
    'effectiveFrom', to_char(rp.effective_from, 'YYYY-MM-DD'),
    'estimated', false
  ),
  rp.created_by,
  rp.created_at
from retail_plan rp
join plan_groups pg on pg.metering_point_id = rp.metering_point_id;

-- ------------------------------------------------------------------
-- tariff_assignment — from `effective_from`, this NMI is priced by network tariff CODE and
-- retail contract GROUP. A metering point cannot be modelled without an assignment covering
-- the period (blocking state in the UI, never a silent fallback).
-- code/group are soft references (a code's versions live across several network_tariff rows;
-- a group's across several retail_contract rows) — validated in the data layer.
-- ------------------------------------------------------------------
create table tariff_assignment (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null,
  metering_point_id     uuid not null,
  network_tariff_code   text not null,
  retail_contract_group uuid not null,
  effective_from        date not null default date '2000-01-01',
  created_by            uuid references auth.users (id),
  created_at            timestamptz not null default now(),
  foreign key (metering_point_id, client_id)
    references metering_point (id, client_id) on delete cascade,
  unique (metering_point_id, effective_from)
);
create index on tariff_assignment (client_id);

alter table tariff_assignment enable row level security;
create policy tariff_assignment_select on tariff_assignment
  for select using (can_access_client(client_id));
create policy tariff_assignment_write on tariff_assignment
  for all using (can_operate_client(client_id)) with check (can_operate_client(client_id));

-- Auto-create baseline assignments so nothing built in v1 breaks: every NMI that already has
-- a tariff_code AND a migrated retail contract group gets an assignment from the far past.
insert into tariff_assignment (client_id, metering_point_id, network_tariff_code, retail_contract_group, effective_from)
select mp.client_id, mp.id, mp.tariff_code, rcg.gid, date '2000-01-01'
from metering_point mp
join lateral (
  select rc.group_id as gid
  from retail_contract rc
  join retail_plan rp on rp.metering_point_id = mp.id
    and rp.client_id = rc.client_id
    and rp.effective_from = rc.effective_from
    and coalesce(rp.label, 'Migrated retail plan') = coalesce(rc.label, 'Migrated retail plan')
  limit 1
) rcg on true
where mp.tariff_code is not null;

-- retail_plan is superseded by retail_contract + tariff_assignment (CLAUDE.md §5b).
drop table retail_plan;

-- ------------------------------------------------------------------
-- bill: composite-FK target so reconciliation can chain client_id to it.
-- ------------------------------------------------------------------
alter table bill add constraint bill_id_client_unique unique (id, client_id);

-- ------------------------------------------------------------------
-- reconciliation — one persisted run of one bill (re-runnable; latest run is current, prior
-- runs are history). Sign-off gates the client report.
-- ------------------------------------------------------------------
create table reconciliation (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null,
  metering_point_id  uuid not null,
  bill_id            uuid not null,
  period_start       date not null,
  period_end         date not null,
  modelled_total     numeric(12, 2) not null,
  billed_total       numeric(12, 2) not null,
  judgement          text not null check (judgement in
    ('match', 'review', 'investigate', 'low-confidence', 'insufficient-data')),
  coverage_fraction  numeric(6, 5),
  estimated_fraction numeric(6, 5),
  computed_at        timestamptz not null default now(),
  signed_off_by      uuid references auth.users (id),
  signed_at          timestamptz,
  foreign key (bill_id, client_id) references bill (id, client_id) on delete cascade,
  foreign key (metering_point_id, client_id)
    references metering_point (id, client_id) on delete cascade,
  unique (id, client_id)
);
create index on reconciliation (client_id);
create index on reconciliation (bill_id);

alter table reconciliation enable row level security;
create policy reconciliation_select on reconciliation
  for select using (can_access_client(client_id));
create policy reconciliation_write on reconciliation
  for all using (can_operate_client(client_id)) with check (can_operate_client(client_id));

-- ------------------------------------------------------------------
-- reconciliation_finding — one per-component variance from a run, triaged by the operator.
-- ------------------------------------------------------------------
create table reconciliation_finding (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null,
  reconciliation_id uuid not null,
  component         text not null,
  label             text not null,
  modelled          numeric(12, 2),
  billed            numeric(12, 2),
  variance          numeric(12, 2) not null,
  variance_pct      numeric(9, 4),
  reason_code       text not null check (reason_code in
    ('overcharge', 'undercharge', 'not_billed', 'not_modelled', 'within_tolerance', 'pass_through')),
  status            text not null default 'open' check (status in
    ('open', 'confirmed_error', 'queried', 'dismissed', 'within_tolerance')),
  operator_note     text,
  recommendation    text,
  foreign key (reconciliation_id, client_id)
    references reconciliation (id, client_id) on delete cascade,
  unique (id, client_id)
);
create index on reconciliation_finding (client_id);
create index on reconciliation_finding (reconciliation_id);

alter table reconciliation_finding enable row level security;
create policy reconciliation_finding_select on reconciliation_finding
  for select using (can_access_client(client_id));
create policy reconciliation_finding_write on reconciliation_finding
  for all using (can_operate_client(client_id)) with check (can_operate_client(client_id));

-- ------------------------------------------------------------------
-- recovery — the chase on a confirmed error, one pipeline row per finding.
-- ------------------------------------------------------------------
create table recovery (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null,
  finding_id        uuid not null,
  state             text not null default 'to_raise' check (state in
    ('to_raise', 'query_lodged', 'responded', 'recovered')),
  amount_identified numeric(12, 2) not null,
  amount_recovered  numeric(12, 2),
  retailer_ref      text,
  raised_at         date,
  lodged_at         date,
  responded_at      date,
  recovered_at      date,
  notes             text,
  created_at        timestamptz not null default now(),
  foreign key (finding_id, client_id)
    references reconciliation_finding (id, client_id) on delete cascade,
  unique (finding_id)
);
create index on recovery (client_id);

alter table recovery enable row level security;
create policy recovery_select on recovery
  for select using (can_access_client(client_id));
create policy recovery_write on recovery
  for all using (can_operate_client(client_id)) with check (can_operate_client(client_id));

-- ------------------------------------------------------------------
-- Ingestion quality gate: the validator's summary lands on the batch, and the operator must
-- accept a batch before it feeds cost/reconciliation. Existing batches are backfilled to
-- 'accepted' — the operator already vetted them by using them.
-- ------------------------------------------------------------------
alter table import_batch
  add column quality_summary jsonb,
  add column review_state text not null default 'pending_review'
    check (review_state in ('pending_review', 'accepted', 'needs_redata'));

update import_batch set review_state = 'accepted';

-- ------------------------------------------------------------------
-- Grants: newer Supabase projects no longer auto-expose new tables to the Data API roles
-- (legacy auto-expose is deprecated), so grant explicitly. RLS above still gates rows —
-- these grants only let the roles reach the tables at all.
-- ------------------------------------------------------------------
grant select, insert, update, delete
  on network_tariff, retail_contract, tariff_assignment,
     reconciliation, reconciliation_finding, recovery
  to authenticated, service_role;
