import { createSupabaseServerClient } from "@/data/supabase/server";

export interface EmissionsFactor {
  region: string;
  factorTPerMwh: number;
  ngaYear: string | null;
}

/** Latest operator-entered emissions factor for a region, or null to use the default. */
export async function getLatestEmissionsFactor(
  region: string,
): Promise<EmissionsFactor | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("emissions_factor")
    .select("region, factor_t_per_mwh, nga_year")
    .eq("region", region)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as {
    region: string;
    factor_t_per_mwh: number | string;
    nga_year: string | null;
  };
  return {
    region: row.region,
    factorTPerMwh: Number(row.factor_t_per_mwh) || 0,
    ngaYear: row.nga_year,
  };
}

export async function createEmissionsFactor(input: {
  orgId: string;
  region: string;
  factorTPerMwh: number;
  ngaYear?: string;
}): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("emissions_factor").insert({
    org_id: input.orgId,
    region: input.region,
    factor_t_per_mwh: input.factorTPerMwh,
    nga_year: input.ngaYear || null,
  });
  if (error) throw error;
}
