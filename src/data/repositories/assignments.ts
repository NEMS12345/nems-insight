import { createSupabaseServerClient } from "@/data/supabase/server";
import { pickEffective, type RetailPlan, type Tariff } from "@/core/tariff";
import {
  listNetworkTariffVersions,
  type NetworkTariffRecord,
} from "@/data/repositories/networkTariffs";
import {
  listRetailContractVersions,
  type RetailContractRecord,
} from "@/data/repositories/retailContracts";

/**
 * [v1.1] tariff_assignment — from `effectiveFrom`, an NMI is priced by a network tariff
 * CODE and a retail contract GROUP. `resolvePricing` is the one place the app turns an
 * assignment into the pure (Tariff, RetailPlan) pair for a date; a metering point with no
 * assignment CANNOT be modelled (blocking state — CLAUDE.md §5b).
 */

export interface TariffAssignment {
  id: string;
  meteringPointId: string;
  clientId: string;
  networkTariffCode: string;
  retailContractGroup: string;
  effectiveFrom: string;
}

interface Row {
  id: string;
  metering_point_id: string;
  client_id: string;
  network_tariff_code: string;
  retail_contract_group: string;
  effective_from: string;
}

const COLS =
  "id, metering_point_id, client_id, network_tariff_code, retail_contract_group, effective_from";

function toAssignment(row: Row): TariffAssignment {
  return {
    id: row.id,
    meteringPointId: row.metering_point_id,
    clientId: row.client_id,
    networkTariffCode: row.network_tariff_code,
    retailContractGroup: row.retail_contract_group,
    effectiveFrom: row.effective_from,
  };
}

export async function listAssignments(meteringPointId: string): Promise<TariffAssignment[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("tariff_assignment")
    .select(COLS)
    .eq("metering_point_id", meteringPointId)
    .order("effective_from", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => toAssignment(r as Row));
}

export interface NewAssignment {
  meteringPointId: string;
  clientId: string;
  networkTariffCode: string;
  retailContractGroup: string;
  effectiveFrom?: string; // omit = baseline
}

/** Create (or replace, on the same effective date) an assignment for an NMI. */
export async function upsertAssignment(input: NewAssignment): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("tariff_assignment").upsert(
    {
      metering_point_id: input.meteringPointId,
      client_id: input.clientId,
      network_tariff_code: input.networkTariffCode,
      retail_contract_group: input.retailContractGroup,
      ...(input.effectiveFrom ? { effective_from: input.effectiveFrom } : {}),
    },
    { onConflict: "metering_point_id,effective_from" },
  );
  if (error) throw error;
}

/** The pricing pair for a metering point, or the reason it can't be modelled. */
export type ResolvedPricing =
  | {
      assigned: true;
      assignment: TariffAssignment;
      /** Pick per bill: pickEffective(tariffVersions, periodStart).rates etc. */
      tariffVersions: NetworkTariffRecord[];
      contractVersions: RetailContractRecord[];
      /** Conveniences resolved for `asOf` (or latest): */
      tariff: Tariff;
      retailPlan: RetailPlan;
    }
  | { assigned: false; reason: "no-assignment" | "no-tariff-rows" | "no-contract-rows" };

/**
 * Resolve what prices an NMI on `asOf` (or currently). Loads the assignment effective on
 * the date, then that code's tariff versions and that group's contract versions, and picks
 * the versions effective on the date — the same pickEffective semantics everywhere.
 */
export async function resolvePricing(
  meteringPointId: string,
  asOf?: string,
): Promise<ResolvedPricing> {
  const assignments = await listAssignments(meteringPointId);
  const assignment = pickEffective(assignments, asOf);
  if (!assignment) return { assigned: false, reason: "no-assignment" };

  const [tariffVersions, contractVersions] = await Promise.all([
    listNetworkTariffVersions(assignment.networkTariffCode),
    listRetailContractVersions(assignment.retailContractGroup),
  ]);
  if (tariffVersions.length === 0) return { assigned: false, reason: "no-tariff-rows" };
  if (contractVersions.length === 0) return { assigned: false, reason: "no-contract-rows" };

  const tariffRec = pickEffective(tariffVersions, asOf)!;
  const contractRec = pickEffective(contractVersions, asOf)!;
  return {
    assigned: true,
    assignment,
    tariffVersions,
    contractVersions,
    tariff: tariffRec.rates,
    retailPlan: contractRec.rates,
  };
}
