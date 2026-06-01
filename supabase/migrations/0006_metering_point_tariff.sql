-- 0006_metering_point_tariff.sql
-- Different NMIs sit on different network tariffs (e.g. a SAC Large warehouse on 7200, a
-- CAC HV office tower on 7400). Record the network tariff code per metering point so the
-- cost engine models each NMI on the right tariff.

alter table metering_point add column tariff_code text;
