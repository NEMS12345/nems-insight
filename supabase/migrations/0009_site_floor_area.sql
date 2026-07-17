-- 0009_site_floor_area.sql
-- Optional floor area per site, to report energy intensity (kWh/m²) — a common C&I
-- benchmarking metric. Optional: the report shows intensity only when it's set.

alter table site add column floor_area_m2 numeric(10, 1);
