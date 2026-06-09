-- 0014_bill_line_item_component.sql
-- NEMS Insight — wire the headline feature: component-wise reconciliation.
--
-- The operator now enters a bill as canonical component buckets (energy peak/shoulder/off-peak,
-- demand, supply, environmental, market, metering, other) rather than a single total. Each
-- bucket is stored as a bill_line_item; this column records which reconciliation-taxonomy
-- component the line maps to, as the "kind:subKey" key (e.g. "energy:peak", "demand:"), so the
-- billed side can be matched component-by-component against the modelled cost.
--
-- Nullable: pre-existing line items (entered before this change) simply carry no component and
-- fall back to total-level reconciliation.

alter table bill_line_item add column component text;
