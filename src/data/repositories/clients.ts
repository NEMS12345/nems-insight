import { createSupabaseServerClient } from "@/data/supabase/server";
import type { Client } from "@/core/types";

interface ClientRow {
  id: string;
  org_id: string;
  name: string;
  abn: string | null;
  status: Client["status"];
}

function toClient(row: ClientRow): Client {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    abn: row.abn ?? undefined,
    status: row.status,
  };
}

/** All clients the current user is allowed to see (RLS enforces the scope). */
export async function listClients(): Promise<Client[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("client")
    .select("id, org_id, name, abn, status")
    .order("name");
  if (error) throw error;
  return (data as ClientRow[]).map(toClient);
}

/** A single client by id, or null if not found / not permitted. */
export async function getClient(id: string): Promise<Client | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("client")
    .select("id, org_id, name, abn, status")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? toClient(data as ClientRow) : null;
}

export interface NewClient {
  orgId: string;
  name: string;
  abn?: string;
  status?: Client["status"];
}

export async function createClient(input: NewClient): Promise<Client> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("client")
    .insert({
      org_id: input.orgId,
      name: input.name,
      abn: input.abn || null,
      status: input.status ?? "prospect",
    })
    .select("id, org_id, name, abn, status")
    .single();
  if (error) throw error;
  return toClient(data as ClientRow);
}
