-- seed.sql — sample data for local development.
--
-- Run this AFTER:
--   1. applying migrations, and
--   2. creating your operator login in Supabase Auth (Authentication -> Users -> Add user),
--      using the email below.
--
-- It is idempotent — safe to run more than once.

-- The email of the operator user you created in Supabase Auth. Change if needed.
-- (We link by email so the seed works without hardcoding a user UUID.)
\set operator_email 'info@nems.au'

-- Fixed UUIDs so re-runs are stable.
-- Organisation
insert into organisation (id, name)
values ('00000000-0000-0000-0000-0000000000a1', 'NEMS')
on conflict (id) do nothing;

-- Link the operator user to the organisation as an 'operator'.
insert into org_member (user_id, org_id, role)
select u.id, '00000000-0000-0000-0000-0000000000a1', 'operator'
from auth.users u
where u.email = :'operator_email'
on conflict (user_id, org_id) do nothing;

-- Sample client portfolio
insert into client (id, org_id, name, abn, status)
values ('00000000-0000-0000-0000-0000000000c1',
        '00000000-0000-0000-0000-0000000000a1',
        'Acme Manufacturing Pty Ltd', '12 345 678 901', 'active')
on conflict (id) do nothing;

-- Sample site (SE QLD / Energex — matches the v1 tariff scope)
insert into site (id, client_id, name, address, state, network)
values ('00000000-0000-0000-0000-0000000000d1',
        '00000000-0000-0000-0000-0000000000c1',
        'Acme Brisbane Plant', '10 Factory Rd, Brisbane QLD 4000', 'QLD', 'Energex')
on conflict (id) do nothing;

-- Sample metering point (NMI)
insert into metering_point (id, site_id, client_id, nmi, meter_type)
values ('00000000-0000-0000-0000-0000000000e1',
        '00000000-0000-0000-0000-0000000000d1',
        '00000000-0000-0000-0000-0000000000c1',
        '31000000000', 'nmi_parent')
on conflict (id) do nothing;
