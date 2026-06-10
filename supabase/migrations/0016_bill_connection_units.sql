-- 0016_bill_connection_units.sql
-- Per-BILL connection-unit count. The DUOS connection unit charge is ratePerUnit × a count
-- that can vary between bills; the per-NMI metering_point.connection_units (0015) is the
-- default, and this column captures the count printed on a specific bill so reconciliation
-- models that period with that bill's own count. Null → fall back to the NMI default.

alter table bill add column connection_units numeric(10, 3);
