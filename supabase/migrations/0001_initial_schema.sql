-- 0001_initial_schema.sql
-- NEMS Insight — Phase 1: data foundation (hierarchy + multi-tenant RLS).
--
-- Hierarchy: organisation -> client (portfolio) -> site -> metering_point (NMI).
-- Interval data, import_batch and raw_file arrive in Phase 2 (ingestion).
--
-- Multi-tenancy is built in NOW even though only operators log in for v1 (see CLAUDE.md §3):
--   * every client-owned row carries client_id,
--   * composite foreign keys guarantee client_id stays consistent down the hierarchy,
--   * Row-Level Security enforces "see only what you're allowed to" at the database.
-- v1 operators get a role that sees ALL clients in their org. The read-only client view
-- and a future self-serve tier are just NARROWER roles on these SAME policies.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type member_role   as enum ('operator', 'client_viewer');
create type client_status as enum ('active', 'prospect', 'archived');
create type meter_type    as enum ('nmi_parent');  -- kept general; v1 = NMI/parent only

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- The operator organisation running the managed service.
create table organisation (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

-- Which auth user belongs to which organisation, and in what role.
-- (auth.users is Supabase's built-in auth table.)
create table org_member (
  user_id     uuid not null references auth.users (id) on delete cascade,
  org_id      uuid not null references organisation (id) on delete cascade,
  role        member_role not null default 'operator',
  created_at  timestamptz not null default now(),
  primary key (user_id, org_id)
);

-- A customer business — the portfolio. This is the tenancy boundary.
create table client (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organisation (id) on delete cascade,
  name        text not null,
  abn         text,
  status      client_status not null default 'prospect',
  created_at  timestamptz not null default now(),
  unique (id, org_id)            -- supports composite FKs / org-scoped integrity
);

-- A client_viewer's access to specific clients. Unused in v1 (operators see all),
-- but the structure is here so the read-only client view and self-serve bolt on later.
create table client_access (
  user_id     uuid not null references auth.users (id) on delete cascade,
  client_id   uuid not null references client (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, client_id)
);

-- A physical premises belonging to a client.
create table site (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null,
  name        text not null,
  address     text,
  state       text,             -- AU state/territory, e.g. 'QLD'
  network     text,             -- DNSP, e.g. 'Energex'
  created_at  timestamptz not null default now(),
  unique (id, client_id),
  foreign key (client_id) references client (id) on delete cascade
);

-- A metering point. v1 = an NMI / parent meter. meter_type stays general so other
-- meter types can be added later without reshaping the model.
-- The composite FK (site_id, client_id) -> site(id, client_id) GUARANTEES a metering
-- point's client_id always matches its site's client_id — tenancy can't drift.
create table metering_point (
  id          uuid primary key default gen_random_uuid(),
  site_id     uuid not null,
  client_id   uuid not null,
  nmi         text not null,
  meter_type  meter_type not null default 'nmi_parent',
  created_at  timestamptz not null default now(),
  unique (id, client_id),
  unique (client_id, nmi),
  foreign key (site_id, client_id) references site (id, client_id) on delete cascade
);

create index on site (client_id);
create index on metering_point (site_id);
create index on metering_point (client_id);

-- ---------------------------------------------------------------------------
-- Access helper functions (SECURITY DEFINER so they don't recurse through RLS)
-- ---------------------------------------------------------------------------

-- Is the current user an operator in this organisation?
create or replace function is_org_operator(p_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from org_member m
    where m.user_id = auth.uid()
      and m.org_id  = p_org_id
      and m.role    = 'operator'
  );
$$;

-- Is the current user an operator for the org that owns this client?
create or replace function can_operate_client(p_client_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from org_member m
    join client c on c.org_id = m.org_id
    where m.user_id = auth.uid()
      and c.id      = p_client_id
      and m.role    = 'operator'
  );
$$;

-- Can the current user READ this client? Operator on its org, OR an explicit viewer.
create or replace function can_access_client(p_client_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select can_operate_client(p_client_id)
      or exists (
        select 1 from client_access ca
        where ca.user_id = auth.uid()
          and ca.client_id = p_client_id
      );
$$;

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- Reads are gated by can_access_client (operators + viewers).
-- Writes are gated by can_operate_client / is_org_operator (operators only) — this is
-- what makes the client view inherently read-only.
-- ---------------------------------------------------------------------------

alter table organisation   enable row level security;
alter table org_member     enable row level security;
alter table client         enable row level security;
alter table client_access  enable row level security;
alter table site           enable row level security;
alter table metering_point enable row level security;

-- organisation: a member can see their own org.
create policy organisation_select on organisation
  for select using (
    exists (
      select 1 from org_member m
      where m.user_id = auth.uid() and m.org_id = organisation.id
    )
  );

-- org_member: a user can see their own memberships. (Membership is provisioned by
-- admin/seed via the service role, which bypasses RLS.)
create policy org_member_select on org_member
  for select using (user_id = auth.uid());

-- client
create policy client_select on client
  for select using (can_access_client(id));
create policy client_insert on client
  for insert with check (is_org_operator(org_id));
create policy client_update on client
  for update using (can_operate_client(id)) with check (is_org_operator(org_id));
create policy client_delete on client
  for delete using (can_operate_client(id));

-- client_access: visible to the user it grants, or to operators of that client.
create policy client_access_select on client_access
  for select using (user_id = auth.uid() or can_operate_client(client_id));
create policy client_access_write on client_access
  for all using (can_operate_client(client_id)) with check (can_operate_client(client_id));

-- site
create policy site_select on site
  for select using (can_access_client(client_id));
create policy site_insert on site
  for insert with check (can_operate_client(client_id));
create policy site_update on site
  for update using (can_operate_client(client_id)) with check (can_operate_client(client_id));
create policy site_delete on site
  for delete using (can_operate_client(client_id));

-- metering_point
create policy metering_point_select on metering_point
  for select using (can_access_client(client_id));
create policy metering_point_insert on metering_point
  for insert with check (can_operate_client(client_id));
create policy metering_point_update on metering_point
  for update using (can_operate_client(client_id)) with check (can_operate_client(client_id));
create policy metering_point_delete on metering_point
  for delete using (can_operate_client(client_id));
