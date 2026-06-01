import { createSupabaseServerClient } from "@/data/supabase/server";

export interface EnergyRollup {
  importKwh: number;
  exportKwh: number;
  readingCount: number;
}

interface EnergyRow {
  import_kwh: number | string;
  export_kwh: number | string;
  reading_count: number | string;
}

function toRollup(row: EnergyRow): EnergyRollup {
  return {
    importKwh: Number(row.import_kwh) || 0,
    exportKwh: Number(row.export_kwh) || 0,
    readingCount: Number(row.reading_count) || 0,
  };
}

const EMPTY: EnergyRollup = { importKwh: 0, exportKwh: 0, readingCount: 0 };

/** Energy totals per client across the whole (accessible) portfolio, keyed by client id. */
export async function clientEnergies(): Promise<Map<string, EnergyRollup>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("client_energy")
    .select("client_id, import_kwh, export_kwh, reading_count");
  if (error) throw error;

  const map = new Map<string, EnergyRollup>();
  for (const row of (data ?? []) as (EnergyRow & { client_id: string })[]) {
    map.set(row.client_id, toRollup(row));
  }
  return map;
}

export async function clientEnergy(clientId: string): Promise<EnergyRollup> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("client_energy")
    .select("import_kwh, export_kwh, reading_count")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw error;
  return data ? toRollup(data as EnergyRow) : EMPTY;
}

/** Energy totals per site for a client, keyed by site id. */
export async function siteEnergiesForClient(
  clientId: string,
): Promise<Map<string, EnergyRollup>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("site_energy")
    .select("site_id, import_kwh, export_kwh, reading_count")
    .eq("client_id", clientId);
  if (error) throw error;

  const map = new Map<string, EnergyRollup>();
  for (const row of (data ?? []) as (EnergyRow & { site_id: string })[]) {
    map.set(row.site_id, toRollup(row));
  }
  return map;
}

/** Energy totals per metering point for a site, keyed by metering point id. */
export async function meteringPointEnergiesForSite(
  siteId: string,
): Promise<Map<string, EnergyRollup>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("metering_point_energy")
    .select("metering_point_id, import_kwh, export_kwh, reading_count")
    .eq("site_id", siteId);
  if (error) throw error;

  const map = new Map<string, EnergyRollup>();
  for (const row of (data ?? []) as (EnergyRow & { metering_point_id: string })[]) {
    map.set(row.metering_point_id, toRollup(row));
  }
  return map;
}
