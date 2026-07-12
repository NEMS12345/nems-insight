-- seed.sql — sample data for getting started.
--
-- Run this AFTER:
--   1. applying the migrations (supabase/migrations — `supabase db push`), and
--   2. creating your operator login in Supabase Auth (Authentication -> Users -> Add user),
--      using the email below.
--
-- Works in the Supabase SQL Editor (plain SQL). It is idempotent — safe to run again.
--
-- The operator user is linked by email. If you used a different email when creating the
-- Auth user, change 'info@nems.au' in the org_member insert below to match.

-- Organisation (fixed UUID so re-runs are stable).
insert into organisation (id, name)
values ('00000000-0000-0000-0000-0000000000a1', 'NEMS')
on conflict (id) do nothing;

-- Link the operator user to the organisation as an 'operator'.
insert into org_member (user_id, org_id, role)
select u.id, '00000000-0000-0000-0000-0000000000a1', 'operator'
from auth.users u
where u.email = 'info@nems.au'
on conflict (user_id, org_id) do nothing;

-- Sample client portfolio
insert into client (id, org_id, name, abn, status)
values ('00000000-0000-0000-0000-0000000000c1',
        '00000000-0000-0000-0000-0000000000a1',
        'Acme Manufacturing Pty Ltd', '12 345 678 901', 'active')
on conflict (id) do nothing;

-- Sample site (SE QLD / Energex — matches the v1 tariff scope)
insert into site (id, client_id, name, address, state, network, timezone)
values ('00000000-0000-0000-0000-0000000000d1',
        '00000000-0000-0000-0000-0000000000c1',
        'Acme Brisbane Plant', '10 Factory Rd, Brisbane QLD 4000', 'QLD', 'Energex',
        'Australia/Brisbane')
on conflict (id) do nothing;

-- Sample metering point (NMI)
insert into metering_point (id, site_id, client_id, nmi, tariff_code, meter_type)
values ('00000000-0000-0000-0000-0000000000e1',
        '00000000-0000-0000-0000-0000000000d1',
        '00000000-0000-0000-0000-0000000000c1',
        '31000000000', '7200', 'nmi_parent')
on conflict (id) do nothing;

-- ============================================================
-- [v1.1] Worked example — the monthly managed-service loop end to end (CLAUDE.md §5b).
-- Acme Foods → Rocklea DC → NMI on Energex 7400 (the invoice-validated tariff; no rates
-- are invented), a retail contract, a June bill entered as component buckets, and a
-- reconciliation with one CONFIRMED demand-charge discrepancy already in recovery.
-- Amounts are illustrative workflow data, clearly a sample; network rates come from the
-- network_tariff rows seeded by migration 0019.
-- ============================================================

insert into client (id, org_id, name, abn, status)
values ('00000000-0000-0000-0000-0000000000c2',
        '00000000-0000-0000-0000-0000000000a1',
        'Acme Foods Pty Ltd', '98 765 432 109', 'active')
on conflict (id) do nothing;

insert into site (id, client_id, name, address, state, network, timezone)
values ('00000000-0000-0000-0000-0000000000d2',
        '00000000-0000-0000-0000-0000000000c2',
        'Rocklea DC', '55 Distribution St, Rocklea QLD 4106', 'QLD', 'Energex',
        'Australia/Brisbane')
on conflict (id) do nothing;

insert into metering_point (id, site_id, client_id, nmi, tariff_code, meter_type,
                            mlf, dlf, connection_voltage, connection_units)
values ('00000000-0000-0000-0000-0000000000e2',
        '00000000-0000-0000-0000-0000000000d2',
        '00000000-0000-0000-0000-0000000000c2',
        '31000000002', '7400', 'nmi_parent',
        1.0106, 1.0439, 'HV', 7)
on conflict (id) do nothing;

-- Retail contract (one baseline version; rates shaped as the pure RetailPlan)
insert into retail_contract (id, client_id, group_id, retailer, label, effective_from, rates)
values ('00000000-0000-0000-0000-0000000000f2',
        '00000000-0000-0000-0000-0000000000c2',
        '00000000-0000-0000-0000-00000000aaf2',
        'Origin', 'Origin contract 2025-26', date '2025-07-01',
        '{"label":"Origin contract 2025-26","peakRatePerKwh":0.072713,"offpeakRatePerKwh":0.093965,"peakWindow":{"dayTypes":["weekday"],"ranges":[{"startMin":420,"endMin":1260}]},"environmentalPerKwh":0.010786,"marketPerKwh":0.001261,"supplyPerDay":0.032437,"meteringPerDay":3.232876,"effectiveFrom":"2025-07-01","estimated":false}'::jsonb)
on conflict (id) do nothing;

insert into tariff_assignment (id, client_id, metering_point_id, network_tariff_code,
                               retail_contract_group, effective_from)
values ('00000000-0000-0000-0000-000000000102',
        '00000000-0000-0000-0000-0000000000c2',
        '00000000-0000-0000-0000-0000000000e2',
        '7400', '00000000-0000-0000-0000-00000000aaf2', date '2025-07-01')
on conflict (id) do nothing;

-- June bill, entered as component buckets (ex-GST, sample workflow data)
insert into bill (id, client_id, metering_point_id, retailer, tariff_code, tariff_name,
                  period_start, period_end, billed_total, connection_units)
values ('00000000-0000-0000-0000-000000000202',
        '00000000-0000-0000-0000-0000000000c2',
        '00000000-0000-0000-0000-0000000000e2',
        'Origin', '7400', 'Energex 7400 (11kV TOU Demand)',
        date '2026-06-01', date '2026-06-30', 41230.00, 7)
on conflict (id) do nothing;

insert into bill_line_item (id, bill_id, client_id, label, category, amount, component)
values
  ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000202',
   '00000000-0000-0000-0000-0000000000c2', 'Energy — peak', 'retail', 14980.00, 'energy:peak'),
  ('00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000202',
   '00000000-0000-0000-0000-0000000000c2', 'Energy — off-peak', 'retail', 10120.00, 'energy:offpeak'),
  ('00000000-0000-0000-0000-000000000303', '00000000-0000-0000-0000-000000000202',
   '00000000-0000-0000-0000-0000000000c2', 'Demand', 'network', 6480.00, 'demand'),
  ('00000000-0000-0000-0000-000000000304', '00000000-0000-0000-0000-000000000202',
   '00000000-0000-0000-0000-0000000000c2', 'Supply / fixed', 'network', 4150.00, 'supply'),
  ('00000000-0000-0000-0000-000000000305', '00000000-0000-0000-0000-000000000202',
   '00000000-0000-0000-0000-0000000000c2', 'Environmental', 'retail', 2050.00, 'environmental'),
  ('00000000-0000-0000-0000-000000000306', '00000000-0000-0000-0000-000000000202',
   '00000000-0000-0000-0000-0000000000c2', 'Metering', 'retail', 100.00, 'metering'),
  ('00000000-0000-0000-0000-000000000307', '00000000-0000-0000-0000-000000000202',
   '00000000-0000-0000-0000-0000000000c2', 'Market / AEMO', 'retail', 250.00, 'market_fees'),
  ('00000000-0000-0000-0000-000000000308', '00000000-0000-0000-0000-000000000202',
   '00000000-0000-0000-0000-0000000000c2', 'Other', 'other', 3100.00, 'other')
on conflict (id) do nothing;

-- The June reconciliation run: demand billed $1,180 over the model → confirmed error.
insert into reconciliation (id, client_id, metering_point_id, bill_id, period_start, period_end,
                            modelled_total, billed_total, judgement, coverage_fraction,
                            estimated_fraction)
values ('00000000-0000-0000-0000-000000000402',
        '00000000-0000-0000-0000-0000000000c2',
        '00000000-0000-0000-0000-0000000000e2',
        '00000000-0000-0000-0000-000000000202',
        date '2026-06-01', date '2026-06-30',
        40050.00, 41230.00, 'investigate', 1.0, 0.0)
on conflict (id) do nothing;

insert into reconciliation_finding (id, client_id, reconciliation_id, component, label,
                                    modelled, billed, variance, variance_pct, reason_code, status,
                                    operator_note, recommendation)
values
  ('00000000-0000-0000-0000-000000000501',
   '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000402',
   'demand', 'Demand', 5300.00, 6480.00, 1180.00, 0.2226, 'overcharge', 'confirmed_error',
   'Billed kVA exceeds metered maximum in the charged window — checked against interval data.',
   'We have identified a demand overcharge of $1,180 on your June invoice and are raising it with Origin on your behalf.'),
  ('00000000-0000-0000-0000-000000000502',
   '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000402',
   'energy:peak', 'Energy — peak', 14930.00, 14980.00, 50.00, 0.0033, 'within_tolerance',
   'within_tolerance', null, null)
on conflict (id) do nothing;

insert into recovery (id, client_id, finding_id, state, amount_identified, raised_at)
values ('00000000-0000-0000-0000-000000000602',
        '00000000-0000-0000-0000-0000000000c2',
        '00000000-0000-0000-0000-000000000501',
        'to_raise', 1180.00, current_date)
on conflict (id) do nothing;
