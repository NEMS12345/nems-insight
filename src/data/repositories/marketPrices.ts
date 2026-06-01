import { createSupabaseServerClient } from "@/data/supabase/server";

export interface MarketPrice {
  region: string;
  futuresPerMwh: number;
  capturedOn: string; // YYYY-MM-DD
}

/** The most recently captured market price for a region (or null if none entered yet). */
export async function getLatestMarketPrice(
  region: string,
): Promise<MarketPrice | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("market_price")
    .select("region, futures_per_mwh, captured_on")
    .eq("region", region)
    .order("captured_on", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as {
    region: string;
    futures_per_mwh: number | string;
    captured_on: string;
  };
  return {
    region: row.region,
    futuresPerMwh: Number(row.futures_per_mwh) || 0,
    capturedOn: row.captured_on,
  };
}

export async function createMarketPrice(input: {
  orgId: string;
  region: string;
  futuresPerMwh: number;
  capturedOn?: string;
}): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("market_price").insert({
    org_id: input.orgId,
    region: input.region,
    futures_per_mwh: input.futuresPerMwh,
    captured_on: input.capturedOn || undefined,
  });
  if (error) throw error;
}
