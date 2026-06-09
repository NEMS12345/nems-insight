import { createSupabaseServerClient } from "@/data/supabase/server";
import type { Site } from "@/core/types";

interface SiteRow {
  id: string;
  client_id: string;
  name: string;
  address: string | null;
  state: string | null;
  network: string | null;
  timezone: string | null;
  floor_area_m2: number | string | null;
}

const COLS = "id, client_id, name, address, state, network, timezone, floor_area_m2";

function toSite(row: SiteRow): Site {
  return {
    id: row.id,
    clientId: row.client_id,
    name: row.name,
    address: row.address ?? undefined,
    state: row.state ?? undefined,
    network: row.network ?? undefined,
    timezone: row.timezone ?? undefined,
    floorAreaM2: row.floor_area_m2 === null ? undefined : Number(row.floor_area_m2),
  };
}

export async function listSitesForClient(clientId: string): Promise<Site[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("site")
    .select(COLS)
    .eq("client_id", clientId)
    .order("name");
  if (error) throw error;
  return (data as SiteRow[]).map(toSite);
}

export async function getSite(id: string): Promise<Site | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("site")
    .select(COLS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? toSite(data as SiteRow) : null;
}

export interface NewSite {
  clientId: string;
  name: string;
  address?: string;
  state?: string;
  network?: string;
  timezone?: string;
  floorAreaM2?: number;
}

export async function createSite(input: NewSite): Promise<Site> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("site")
    .insert({
      client_id: input.clientId,
      name: input.name,
      address: input.address || null,
      state: input.state || null,
      network: input.network || null,
      timezone: input.timezone || null,
      floor_area_m2: input.floorAreaM2 ?? null,
    })
    .select(COLS)
    .single();
  if (error) throw error;
  return toSite(data as SiteRow);
}
