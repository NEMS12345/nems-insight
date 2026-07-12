-- 0018_client_select_self_reference.sql
-- Fix: creating a client via the app failed with "new row violates row-level security policy".
--
-- The app inserts with a RETURNING read-back (supabase-js .insert().select()). Postgres applies
-- the SELECT policy to RETURNING rows, and client_select used can_access_client(id), which joins
-- the client table itself to find the org — but a row inserted by the current statement is not
-- yet visible to subqueries within that statement, so the policy always failed for fresh rows.
--
-- The fix: judge the client row by ITS OWN org_id column (no self-join). Semantics are identical
-- for existing rows — is_org_operator(org_id) is exactly what can_operate_client resolves to for
-- a client row — and RETURNING now works because org_id is read straight off the new tuple.
-- Child tables (site, metering_point, bills, ...) keep can_access_client(client_id): their parent
-- client row always pre-exists, so the join is fine there.

drop policy client_select on client;
create policy client_select on client
  for select using (
    is_org_operator(org_id)
    or exists (
      select 1 from client_access ca
      where ca.user_id = auth.uid()
        and ca.client_id = client.id
    )
  );
