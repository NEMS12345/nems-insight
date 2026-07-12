import { createSupabaseServerClient } from "@/data/supabase/server";
import type { AnalyticsReading } from "@/core/analytics";
import type { ReadingUnit, QualityFlag, IntervalLength } from "@/core/types";

export interface MeteringPointDetail {
  id: string;
  siteId: string;
  clientId: string;
  nmi: string;
  tariffCode: string | null;
  mlf: number | null;
  dlf: number | null;
  connectionVoltage: "LV" | "HV" | null;
  assumedPf: number | null;
  connectionUnits: number | null;
}

export async function getMeteringPointDetail(
  id: string,
): Promise<MeteringPointDetail | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("metering_point")
    .select("id, site_id, client_id, nmi, tariff_code, mlf, dlf, connection_voltage, assumed_pf, connection_units")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as {
    id: string;
    site_id: string;
    client_id: string;
    nmi: string;
    tariff_code: string | null;
    mlf: number | string | null;
    dlf: number | string | null;
    connection_voltage: "LV" | "HV" | null;
    assumed_pf: number | string | null;
    connection_units: number | string | null;
  };
  return {
    id: row.id,
    siteId: row.site_id,
    clientId: row.client_id,
    nmi: row.nmi,
    tariffCode: row.tariff_code,
    mlf: row.mlf === null ? null : Number(row.mlf),
    dlf: row.dlf === null ? null : Number(row.dlf),
    connectionVoltage: row.connection_voltage,
    assumedPf: row.assumed_pf === null ? null : Number(row.assumed_pf),
    connectionUnits: row.connection_units === null ? null : Number(row.connection_units),
  };
}

interface ReadingRow {
  channel: string;
  interval_start: string;
  interval_length: number;
  value: number;
  unit: ReadingUnit;
  quality: QualityFlag;
}

const PAGE = 1000;
const MAX_ROWS = 200_000; // safety cap (~years of multi-channel interval data)

/**
 * All interval readings for a metering point, as analytics-ready rows. Paginates because
 * Supabase caps a single response, and a year of interval data spans many pages.
 *
 * [v1.1] The quality gate: pass `gateClientId` (the NMI's client) and readings from any
 * import batch that is not ACCEPTED are excluded — a non-accepted batch must not feed
 * cost or reconciliation (CLAUDE.md §5b). Callers that render cost/reconciliation MUST
 * pass it; pre-gate rows (no batch id) always pass.
 */
export async function getReadingsForMeteringPoint(
  meteringPointId: string,
  gateClientId?: string,
): Promise<AnalyticsReading[]> {
  const supabase = await createSupabaseServerClient();

  let excluded: string[] = [];
  if (gateClientId) {
    const { nonAcceptedBatchIds } = await import("@/data/repositories/imports");
    excluded = await nonAcceptedBatchIds(gateClientId);
  }

  const out: AnalyticsReading[] = [];

  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    let query = supabase
      .from("interval_reading")
      .select("channel, interval_start, interval_length, value, unit, quality")
      .eq("metering_point_id", meteringPointId)
      .order("interval_start", { ascending: true })
      .range(from, from + PAGE - 1);
    if (excluded.length > 0) {
      query = query.or(
        `import_batch_id.is.null,import_batch_id.not.in.(${excluded.join(",")})`,
      );
    }
    const { data, error } = await query;
    if (error) throw error;

    const rows = (data ?? []) as ReadingRow[];
    for (const r of rows) {
      out.push({
        channel: r.channel,
        intervalStart: r.interval_start,
        intervalLength: r.interval_length as IntervalLength,
        value: r.value,
        unit: r.unit,
        quality: r.quality,
      });
    }
    if (rows.length < PAGE) break;
  }

  return out;
}
