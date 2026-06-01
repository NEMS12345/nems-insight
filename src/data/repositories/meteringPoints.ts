import { createSupabaseServerClient } from "@/data/supabase/server";
import type { MeteringPoint } from "@/core/types";

interface MeteringPointRow {
  id: string;
  site_id: string;
  nmi: string;
  meter_serial: string | null;
  tariff_code: string | null;
  meter_type: MeteringPoint["meterType"];
}

const COLS = "id, site_id, nmi, meter_serial, tariff_code, meter_type";

function toMeteringPoint(row: MeteringPointRow): MeteringPoint {
  return {
    id: row.id,
    siteId: row.site_id,
    nmi: row.nmi,
    meterSerial: row.meter_serial ?? undefined,
    tariffCode: row.tariff_code ?? undefined,
    meterType: row.meter_type,
  };
}

export async function listMeteringPointsForSite(
  siteId: string,
): Promise<MeteringPoint[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("metering_point")
    .select(COLS)
    .eq("site_id", siteId)
    .order("nmi");
  if (error) throw error;
  return (data as MeteringPointRow[]).map(toMeteringPoint);
}

export interface NewMeteringPoint {
  siteId: string;
  /** Denormalised tenancy key; must match the site's client_id (DB enforces this). */
  clientId: string;
  nmi: string;
  meterSerial?: string;
  tariffCode?: string;
}

export async function createMeteringPoint(
  input: NewMeteringPoint,
): Promise<MeteringPoint> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("metering_point")
    .insert({
      site_id: input.siteId,
      client_id: input.clientId,
      nmi: input.nmi,
      meter_serial: input.meterSerial || null,
      tariff_code: input.tariffCode || null,
      meter_type: "nmi_parent",
    })
    .select(COLS)
    .single();
  if (error) throw error;
  return toMeteringPoint(data as MeteringPointRow);
}
