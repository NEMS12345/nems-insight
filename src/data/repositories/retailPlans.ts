import { createSupabaseServerClient } from "@/data/supabase/server";
import type { RetailPlan } from "@/core/tariff";
import { pickRetailPlan } from "@/core/tariff";

interface RetailPlanRow {
  label: string | null;
  peak_rate: number | string;
  offpeak_rate: number | string;
  peak_start_hour: number;
  peak_end_hour: number;
  environmental_rate: number | string;
  market_rate: number | string;
  supply_per_day: number | string;
  metering_per_day: number | string;
  effective_from: string;
}

const COLS =
  "label, peak_rate, offpeak_rate, peak_start_hour, peak_end_hour, environmental_rate, market_rate, supply_per_day, metering_per_day, effective_from";

function toRetailPlan(row: RetailPlanRow): RetailPlan {
  return {
    label: row.label ?? "Retail plan",
    peakRatePerKwh: Number(row.peak_rate) || 0,
    offpeakRatePerKwh: Number(row.offpeak_rate) || 0,
    peakWindow: {
      dayTypes: ["weekday"],
      ranges: [{ startMin: row.peak_start_hour * 60, endMin: row.peak_end_hour * 60 }],
    },
    environmentalPerKwh: Number(row.environmental_rate) || 0,
    marketPerKwh: Number(row.market_rate) || 0,
    supplyPerDay: Number(row.supply_per_day) || 0,
    meteringPerDay: Number(row.metering_per_day) || 0,
    effectiveFrom: row.effective_from,
    estimated: false,
  };
}

/** All retail plan versions for an NMI, newest-effective first (empty if none entered). */
export async function listRetailPlans(meteringPointId: string): Promise<RetailPlan[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("retail_plan")
    .select(COLS)
    .eq("metering_point_id", meteringPointId)
    .order("effective_from", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => toRetailPlan(row as RetailPlanRow));
}

/**
 * The retail plan for an NMI effective on `asOf` ("YYYY-MM-DD"), or null if none entered. Without
 * `asOf`, the latest version. See `pickRetailPlan` for the selection rule.
 */
export async function getRetailPlan(
  meteringPointId: string,
  asOf?: string,
): Promise<RetailPlan | null> {
  const plans = await listRetailPlans(meteringPointId);
  return pickRetailPlan(plans, asOf) ?? null;
}

export interface NewRetailPlan {
  meteringPointId: string;
  clientId: string;
  label?: string;
  peakRate: number;
  offpeakRate: number;
  peakStartHour: number;
  peakEndHour: number;
  environmentalRate: number;
  marketRate: number;
  supplyPerDay: number;
  meteringPerDay: number;
  /** "YYYY-MM-DD"; omit to write/replace the baseline version. */
  effectiveFrom?: string;
}

/**
 * Insert or replace a retail plan version for an NMI. One plan per (NMI, effective date): saving
 * with a new `effectiveFrom` adds a version; saving with an existing one replaces it.
 */
export async function upsertRetailPlan(input: NewRetailPlan): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("retail_plan").upsert(
    {
      metering_point_id: input.meteringPointId,
      client_id: input.clientId,
      label: input.label || null,
      peak_rate: input.peakRate,
      offpeak_rate: input.offpeakRate,
      peak_start_hour: input.peakStartHour,
      peak_end_hour: input.peakEndHour,
      environmental_rate: input.environmentalRate,
      market_rate: input.marketRate,
      supply_per_day: input.supplyPerDay,
      metering_per_day: input.meteringPerDay,
      ...(input.effectiveFrom ? { effective_from: input.effectiveFrom } : {}),
    },
    { onConflict: "metering_point_id,effective_from" },
  );
  if (error) throw error;
}
