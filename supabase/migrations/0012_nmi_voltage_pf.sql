-- 0012_nmi_voltage_pf.sql
-- Per-NMI connection voltage (eligibility) and an optional assumed power factor.
--   connection_voltage: 'LV' | 'HV' — a physical constraint on which tariffs apply. When
--     null, the report must not offer cross-voltage tariff alternatives.
--   assumed_pf: used only when the data has no reactive channel and a kVA-demand tariff is
--     being assessed; never defaults to 1.0.

alter table metering_point add column connection_voltage text;  -- 'LV' | 'HV'
alter table metering_point add column assumed_pf numeric(4, 3);
