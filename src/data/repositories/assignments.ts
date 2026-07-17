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

/**
 * [v1.1] Everything the setup wizard needs in one shape: every NMI with its site/client
 * names, current assignment (if any), plus each client's contract groups for the picker.
 */
export interface SetupRow {
  meteringPointId: string;
  nmi: string;
  clientId: string;
  clientName: string;
  siteId: string;
  siteName: string;
  tariffCodeHint: string | null;
  assignment: TariffAssignment | null;
}

export interface ContractGroupOption {
  groupId: string;
  clientId: string;
  label: string;
}

export async function setupOverview(): Promise<{
  rows: SetupRow[];
  contractGroups: ContractGroupOption[];
}> {
  const supabase = await createSupabaseServerClient();
  const [mps, sites, clients, assignments, contracts] = await Promise.all([
    supabase.from("metering_point").select("id, nmi, client_id, site_id, tariff_code"),
    supabase.from("site").select("id, name"),
    supabase.from("client").select("id, name"),
    supabase.from("tariff_assignment").select(COLS),
    supabase.from("retail_contract").select("group_id, client_id, label, retailer, effective_from"),
  ]);
  for (const r of [mps, sites, clients, assignments, contracts]) {
    if (r.error) throw r.error;
  }

  const siteName = new Map(
    ((sites.data ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]),
  );
  const clientName = new Map(
    ((clients.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]),
  );
  const byMp = new Map<string, TariffAssignment[]>();
  for (const raw of (assignments.data ?? []) as Row[]) {
    const a = toAssignment(raw);
    const arr = byMp.get(a.meteringPointId) ?? [];
    arr.push(a);
    byMp.set(a.meteringPointId, arr);
  }

  const rows: SetupRow[] = (
    (mps.data ?? []) as {
      id: string;
      nmi: string;
      client_id: string;
      site_id: string;
      tariff_code: string | null;
    }[]
  ).map((m) => ({
    meteringPointId: m.id,
    nmi: m.nmi,
    clientId: m.client_id,
    clientName: clientName.get(m.client_id) ?? "—",
    siteId: m.site_id,
    siteName: siteName.get(m.site_id) ?? "—",
    tariffCodeHint: m.tariff_code,
    assignment: pickEffective(byMp.get(m.id) ?? []) ?? null,
  }));

  // One picker option per contract group (label from its newest version).
  const seen = new Map<string, ContractGroupOption>();
  for (const c of (contracts.data ?? []) as {
    group_id: string;
    client_id: string;
    label: string | null;
    retailer: string | null;
    effective_from: string;
  }[]) {
    if (!seen.has(c.group_id)) {
      seen.set(c.group_id, {
        groupId: c.group_id,
        clientId: c.client_id,
        label: [c.retailer, c.label ?? "Contract"].filter(Boolean).join(" — "),
      });
    }
  }
  return { rows, contractGroups: [...seen.values()] };
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
