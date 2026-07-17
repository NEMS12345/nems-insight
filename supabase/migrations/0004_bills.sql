-- 0004_bills.sql
-- NEMS Insight — Phase 4: structured bill capture (for reconciliation against modelled cost).
--
-- The operator enters a bill's facts via a form (NOT automated PDF parsing): retailer,
-- tariff, period, billed total, and optional line items. The original PDF can be attached
-- via raw_file. Amounts are stored EX-GST to compare like-for-like with the modelled cost.
--
-- Same tenancy discipline as the rest of the schema: client_id on every row, composite FK
-- so a bill's NMI can't belong to another client, and RLS (operators write, viewers read).

create table bill (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null,
  metering_point_id uuid not null,
  retailer          text,
  tariff_code       text,                 -- network tariff code, e.g. '7200'
  tariff_name       text,
  period_start      date not null,
  period_end        date not null,
  billed_total      numeric(12, 2) not null,  -- ex-GST
  notes             text,
  raw_file_id       uuid references raw_file (id) on delete set null,
  created_by        uuid references auth.users (id),
  created_at        timestamptz not null default now(),
  foreign key (metering_point_id, client_id)
    references metering_point (id, client_id) on delete cascade
);

create table bill_line_item (
  id        uuid primary key default gen_random_uuid(),
  bill_id   uuid not null references bill (id) on delete cascade,
  client_id uuid not null references client (id) on delete cascade,
  label     text not null,
  category  text,                         -- 'network' | 'retail' | other
  amount    numeric(12, 2) not null       -- ex-GST
);

create index on bill (metering_point_id);
create index on bill (client_id);
create index on bill_line_item (bill_id);

alter table bill           enable row level security;
alter table bill_line_item enable row level security;

create policy bill_select on bill
  for select using (can_access_client(client_id));
create policy bill_write on bill
  for all using (can_operate_client(client_id)) with check (can_operate_client(client_id));

create policy bill_line_item_select on bill_line_item
  for select using (can_access_client(client_id));
create policy bill_line_item_write on bill_line_item
  for all using (can_operate_client(client_id)) with check (can_operate_client(client_id));
