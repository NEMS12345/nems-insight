import { createSupabaseServerClient } from "@/data/supabase/server";
import type { Tariff } from "@/core/tariff";

/**
 * [v1.1] network_tariff — editable, dated DNSP rate-set versions (org reference data).
 * A row's `rates` jsonb IS the pure engine `Tariff`; the data layer only loads and
 * shallow-checks it — pricing stays in the pure core.
 */

export interface NetworkTariffRecord {
  id: string;
  code: string;
  name: string;
  dnsp: string;
  effectiveFrom: string; // date; the far-past default acts as the baseline
  rates: Tariff;
  sourceNote: string | null;
}

interface Row {
  id: string;
  code: string;
  name: string;
  dnsp: string;
  effective_from: string;
  rates: unknown;
  source_note: string | null;
}

function toRecord(row: Row): NetworkTariffRecord {
  const rates = row.rates as Tariff;
  if (!rates || !Array.isArray(rates.charges) || !rates.periods) {
    throw new Error(`network_tariff ${row.code} (${row.effective_from}): rates JSON is not a Tariff`);
  }
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    dnsp: row.dnsp,
    effectiveFrom: row.effective_from,
    rates: { ...rates, effectiveFrom: rates.effectiveFrom ?? row.effective_from },
    sourceNote: row.source_note,
  };
}

const COLS = "id, code, name, dnsp, effective_from, rates, source_note";

/** All tariff versions visible to the operator's org, newest-effective first per code. */
export async function listNetworkTariffs(): Promise<NetworkTariffRecord[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("network_tariff")
    .select(COLS)
    .order("code", { ascending: true })
    .order("effective_from", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => toRecord(r as Row));
}

/** The dated version set for one tariff code (for pickEffective at costing time). */
export async function listNetworkTariffVersions(code: string): Promise<NetworkTariffRecord[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("network_tariff")
    .select(COLS)
    .eq("code", code)
    .order("effective_from", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => toRecord(r as Row));
}

export interface NewNetworkTariff {
  orgId: string;
  code: string;
  name: string;
  dnsp: string;
  effectiveFrom: string;
  rates: Tariff;
  sourceNote?: string;
}

/** Add a new dated rate-set version. Versions are superseded, never edited in place. */
export async function insertNetworkTariff(input: NewNetworkTariff): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("network_tariff").insert({
    org_id: input.orgId,
    code: input.code,
    name: input.name,
    dnsp: input.dnsp,
    effective_from: input.effectiveFrom,
    rates: input.rates,
    source_note: input.sourceNote ?? null,
  });
  if (error) throw error;
}
