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
