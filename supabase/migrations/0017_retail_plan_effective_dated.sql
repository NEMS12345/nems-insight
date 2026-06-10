-- 0017_retail_plan_effective_dated.sql
-- Effective-date retail plans, mirroring the network tariff registry (TARIFF_VERSIONS / getTariff).
-- Retail rates change over a contract's life, so an NMI can now hold multiple plan VERSIONS keyed
-- by `effective_from`. A bill is costed on the version effective during its period
-- (pickRetailPlan(plans, periodStart)); older bills stay correct after a rate change and new bills
-- get the new rates — no fork. Existing single plans get a far-past baseline date so they keep
-- applying to all periods (unchanged behaviour until a second version is added).

alter table retail_plan
  add column effective_from date not null default date '2000-01-01';

-- One plan per (NMI, effective date) instead of one plan per NMI.
alter table retail_plan drop constraint retail_plan_metering_point_id_key;
alter table retail_plan add constraint retail_plan_nmi_effective_unique
  unique (metering_point_id, effective_from);
