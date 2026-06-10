import { createSupabaseServerClient } from "@/data/supabase/server";
import type { MeteringPoint } from "@/core/types";

interface MeteringPointRow {
  id: string;
  site_id: string;
  nmi: string;
  meter_serial: string | null;
  tariff_code: string | null;
  mlf: number | string | null;
  dlf: number | string | null;
  meter_type: MeteringPoint["meterType"];
}

const COLS = "id, site_id, nmi, meter_serial, tariff_code, mlf, dlf, meter_type";

function toMeteringPoint(row: MeteringPointRow): MeteringPoint {
  return {
    id: row.id,
    siteId: row.site_id,
    nmi: row.nmi,
    meterSerial: row.meter_serial ?? undefined,
    tariffCode: row.tariff_code ?? undefined,
    mlf: row.mlf === null ? undefined : Number(row.mlf),
    dlf: row.dlf === null ? undefined : Number(row.dlf),
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
  mlf?: number;
  dlf?: number;
  connectionVoltage?: "LV" | "HV";
  assumedPf?: number;
  connectionUnits?: number;
}

/**
 * Editable per-NMI settings. These are captured at NMI creation but must be correctable
 * afterwards (loss factors arrive late, a tariff is reassigned, a connection-unit count is
 * learned from the first bill). `undefined`/blank clears the column. Runs as the operator
 * under RLS; the composite-FK chain keeps `client_id` honest.
 */
export interface MeteringPointSettings {
  tariffCode?: string;
  mlf?: number;
  dlf?: number;
  connectionVoltage?: "LV" | "HV";
  assumedPf?: number;
  connectionUnits?: number;
}

export async function updateMeteringPointSettings(
  id: string,
  settings: MeteringPointSettings,
): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("metering_point")
    .update({
      tariff_code: settings.tariffCode || null,
      mlf: settings.mlf ?? null,
      dlf: settings.dlf ?? null,
      connection_voltage: settings.connectionVoltage || null,
      assumed_pf: settings.assumedPf ?? null,
      connection_units: settings.connectionUnits ?? null,
    })
    .eq("id", id);
  if (error) throw error;
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
      mlf: input.mlf ?? null,
      dlf: input.dlf ?? null,
      connection_voltage: input.connectionVoltage || null,
      assumed_pf: input.assumedPf ?? null,
      connection_units: input.connectionUnits ?? null,
      meter_type: "nmi_parent",
    })
    .select(COLS)
    .single();
  if (error) throw error;
  return toMeteringPoint(data as MeteringPointRow);
}
