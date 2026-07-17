-- 0015_metering_point_connection_units.sql
-- Per-NMI connection-unit count for the DUOS connection unit charge (Energex 11kV / tariff
-- 7400). The charge is billed as ratePerUnit × this count; the count is a capacity figure off
-- the bill that varies between bills, so it is data on the NMI, not part of the tariff. When
-- null the charge is modelled as $0 and the client report flags it (it understates cost).

alter table metering_point add column connection_units numeric(10, 3);
