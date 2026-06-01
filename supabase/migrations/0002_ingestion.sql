-- 0002_ingestion.sql
-- NEMS Insight — Phase 2: ingestion tables (interval data + audit trail + raw files).
--
-- Same tenancy discipline as Phase 1: every row carries client_id, composite FKs keep it
-- consistent with the hierarchy, and RLS gates reads (operators + viewers) vs writes
-- (operators only). interval_reading is keyed by (metering_point, channel, interval_start)
-- because a metering point reports multiple channels (E/B/Q) per interval.

-- Quality labels mirror the NEM12 codes (A/S/F/E/N) but use the readable domain names so
-- the stored value matches core's QualityFlag exactly — no lossy mapping.
create type quality_flag as enum (
  'actual',            -- A
  'substituted',       -- S
  'final-substituted', -- F
  'estimated',         -- E
  'null'               -- N (no data)
);

-- The original uploaded file, kept verbatim (bytes live in Supabase Storage; this row is
-- the metadata + pointer) so we can always re-parse from source.
create table raw_file (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references client (id) on delete cascade,
  storage_path  text not null,           -- path within the private 'raw-files' bucket
  filename      text not null,
  content_type  text,
  byte_size     bigint,
  sha256        text,
  uploaded_by   uuid references auth.users (id),
  uploaded_at   timestamptz not null default now()
);

-- One row per uploaded file: the import audit trail.
create table import_batch (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references client (id) on delete cascade,
  raw_file_id    uuid references raw_file (id) on delete set null,
  filename       text,
  format         text not null default 'NEM12',
  status         text not null default 'pending',  -- pending | parsed | partial | failed
  uploaded_by    uuid references auth.users (id),
  uploaded_at    timestamptz not null default now(),
  reading_count  integer not null default 0,
  error_count    integer not null default 0,
  warning_count  integer not null default 0,
  errors         jsonb not null default '[]'::jsonb,
  warnings       jsonb not null default '[]'::jsonb
);

-- The interval time-series.
create table interval_reading (
  id               bigint generated always as identity primary key,
  client_id        uuid not null,
  metering_point_id uuid not null,
  channel          text not null,            -- NMI suffix, e.g. E1 / B1 / Q1
  interval_start   timestamptz not null,
  interval_length  smallint not null,        -- minutes
  value            double precision not null,
  unit             text not null,            -- 'kWh' | 'kVArh'
  quality          quality_flag not null,
  import_batch_id  uuid references import_batch (id) on delete set null,
  created_at       timestamptz not null default now(),
  -- Composite FK guarantees a reading's client_id matches its metering point's client_id.
  foreign key (metering_point_id, client_id)
    references metering_point (id, client_id) on delete cascade,
  -- Natural key: one value per metering point + channel + interval (supports re-import upsert).
  unique (metering_point_id, channel, interval_start)
);

create index on raw_file (client_id);
create index on import_batch (client_id);
create index on interval_reading (client_id);
create index on interval_reading (import_batch_id);

-- ---------------------------------------------------------------------------
-- Row-Level Security (same pattern as Phase 1)
-- ---------------------------------------------------------------------------
alter table raw_file         enable row level security;
alter table import_batch     enable row level security;
alter table interval_reading enable row level security;

create policy raw_file_select on raw_file
  for select using (can_access_client(client_id));
create policy raw_file_write on raw_file
  for all using (can_operate_client(client_id)) with check (can_operate_client(client_id));

create policy import_batch_select on import_batch
  for select using (can_access_client(client_id));
create policy import_batch_write on import_batch
  for all using (can_operate_client(client_id)) with check (can_operate_client(client_id));

create policy interval_reading_select on interval_reading
  for select using (can_access_client(client_id));
create policy interval_reading_write on interval_reading
  for all using (can_operate_client(client_id)) with check (can_operate_client(client_id));
