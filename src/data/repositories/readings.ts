import { createSupabaseServerClient } from "@/data/supabase/server";
import type { AnalyticsReading } from "@/core/analytics";
import type { ReadingUnit, QualityFlag, IntervalLength } from "@/core/types";

export interface MeteringPointDetail {
  id: string;
  siteId: string;
  clientId: string;
  nmi: string;
  tariffCode: string | null;
}

export async function getMeteringPointDetail(
  id: string,
): Promise<MeteringPointDetail | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("metering_point")
    .select("id, site_id, client_id, nmi, tariff_code")
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
  };
  return {
    id: row.id,
    siteId: row.site_id,
    clientId: row.client_id,
    nmi: row.nmi,
    tariffCode: row.tariff_code,
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
 */
export async function getReadingsForMeteringPoint(
  meteringPointId: string,
): Promise<AnalyticsReading[]> {
  const supabase = await createSupabaseServerClient();
  const out: AnalyticsReading[] = [];

  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await supabase
      .from("interval_reading")
      .select("channel, interval_start, interval_length, value, unit, quality")
      .eq("metering_point_id", meteringPointId)
      .order("interval_start", { ascending: true })
      .range(from, from + PAGE - 1);
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
