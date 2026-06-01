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
