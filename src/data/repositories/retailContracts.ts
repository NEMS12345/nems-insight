import { createSupabaseServerClient } from "@/data/supabase/server";
import type { RetailPlan } from "@/core/tariff";

/**
 * [v1.1] retail_contract — dated retail rate-set versions for a client. Versions of the
 * same contract share `group_id`; an assignment points at the group and the version
 * effective during a bill's period is picked at costing time (pickEffective).
 */

export interface RetailContractRecord {
  id: string;
  clientId: string;
  groupId: string;
  retailer: string | null;
  label: string | null;
  effectiveFrom: string;
  rates: RetailPlan;
}

interface Row {
  id: string;
  client_id: string;
  group_id: string;
  retailer: string | null;
  label: string | null;
  effective_from: string;
  rates: unknown;
}

function toRecord(row: Row): RetailContractRecord {
  const rates = row.rates as RetailPlan;
  if (!rates || typeof rates.peakRatePerKwh !== "number" || !rates.peakWindow) {
    throw new Error(`retail_contract ${row.id}: rates JSON is not a RetailPlan`);
  }
  return {
    id: row.id,
    clientId: row.client_id,
    groupId: row.group_id,
    retailer: row.retailer,
    label: row.label,
    effectiveFrom: row.effective_from,
    rates: {
      ...rates,
      label: rates.label ?? row.label ?? "Retail contract",
      effectiveFrom: rates.effectiveFrom ?? row.effective_from,
    },
  };
}

const COLS = "id, client_id, group_id, retailer, label, effective_from, rates";

/** All contract versions for a client, grouped by group_id in the caller. */
export async function listRetailContractsForClient(
  clientId: string,
): Promise<RetailContractRecord[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("retail_contract")
    .select(COLS)
    .eq("client_id", clientId)
    .order("effective_from", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => toRecord(r as Row));
}

/** The dated version set for one contract group. */
export async function listRetailContractVersions(
  groupId: string,
): Promise<RetailContractRecord[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("retail_contract")
    .select(COLS)
    .eq("group_id", groupId)
    .order("effective_from", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => toRecord(r as Row));
}

export interface NewRetailContractVersion {
  clientId: string;
  /** Omit to start a new contract group; pass to add/replace a version in a group. */
  groupId?: string;
  retailer?: string;
  label?: string;
  effectiveFrom?: string; // omit = baseline
  rates: RetailPlan;
}

/**
 * Insert (or replace, on the same effective date) a contract version. Returns the group id
 * so a caller starting a new group can assign it.
 */
export async function upsertRetailContractVersion(
  input: NewRetailContractVersion,
): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const row = {
    client_id: input.clientId,
    ...(input.groupId ? { group_id: input.groupId } : {}),
    retailer: input.retailer ?? null,
    label: input.label ?? null,
    ...(input.effectiveFrom ? { effective_from: input.effectiveFrom } : {}),
    rates: input.rates,
  };
  if (input.groupId) {
    const { data, error } = await supabase
      .from("retail_contract")
      .upsert(row, { onConflict: "group_id,effective_from" })
      .select("group_id")
      .single();
    if (error) throw error;
    return (data as { group_id: string }).group_id;
  }
  const { data, error } = await supabase
    .from("retail_contract")
    .insert(row)
    .select("group_id")
    .single();
  if (error) throw error;
  return (data as { group_id: string }).group_id;
}
