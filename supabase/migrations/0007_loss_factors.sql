-- 0007_loss_factors.sql
-- Loss factors are NMI/location-specific and scale energy charges on the bill
-- (MLF = marginal/transmission loss factor, DLF = distribution loss factor).
-- Stored per metering point and applied explicitly by the cost engine.

alter table metering_point add column mlf numeric(8, 5);
alter table metering_point add column dlf numeric(8, 5);
