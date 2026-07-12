import { createSupabaseServerClient } from "@/data/supabase/server";

/**
 * [v1.1] recovery — the chase on a confirmed billing error:
 * to_raise → query_lodged → responded → recovered. Closes the value loop with a portfolio
 * "$ recovered" metric. Pure workflow state (data + app layers only).
 */

export type RecoveryState = "to_raise" | "query_lodged" | "responded" | "recovered";

export interface Recovery {
  id: string;
  clientId: string;
  findingId: string;
  state: RecoveryState;
  amountIdentified: number;
  amountRecovered: number | null;
  retailerRef: string | null;
  raisedAt: string | null;
  lodgedAt: string | null;
  respondedAt: string | null;
  recoveredAt: string | null;
  notes: string | null;
}

interface Row {
  id: string;
  client_id: string;
  finding_id: string;
  state: RecoveryState;
  amount_identified: number | string;
  amount_recovered: number | string | null;
  retailer_ref: string | null;
  raised_at: string | null;
  lodged_at: string | null;
  responded_at: string | null;
  recovered_at: string | null;
  notes: string | null;
}

const COLS =
  "id, client_id, finding_id, state, amount_identified, amount_recovered, retailer_ref, raised_at, lodged_at, responded_at, recovered_at, notes";

function toRecovery(r: Row): Recovery {
  return {
    id: r.id,
    clientId: r.client_id,
    findingId: r.finding_id,
    state: r.state,
    amountIdentified: Number(r.amount_identified),
    amountRecovered: r.amount_recovered == null ? null : Number(r.amount_recovered),
    retailerRef: r.retailer_ref,
    raisedAt: r.raised_at,
    lodgedAt: r.lodged_at,
    respondedAt: r.responded_at,
    recoveredAt: r.recovered_at,
    notes: r.notes,
  };
}

/** Open a recovery for a confirmed-error finding (idempotent — one per finding). */
export async function openRecovery(input: {
  clientId: string;
  findingId: string;
  amountIdentified: number;
}): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("recovery").upsert(
    {
      client_id: input.clientId,
      finding_id: input.findingId,
      amount_identified: input.amountIdentified,
      raised_at: new Date().toISOString().slice(0, 10),
    },
    { onConflict: "finding_id", ignoreDuplicates: true },
  );
  if (error) throw error;
}

/** Advance a recovery through the pipeline, stamping the matching date. */
export async function updateRecovery(input: {
  recoveryId: string;
  state: RecoveryState;
  amountRecovered?: number;
  retailerRef?: string;
  notes?: string;
}): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const today = new Date().toISOString().slice(0, 10);
  const stamp: Record<string, string> = {
    query_lodged: "lodged_at",
    responded: "responded_at",
    recovered: "recovered_at",
  };
  const { error } = await supabase
    .from("recovery")
    .update({
      state: input.state,
      ...(input.amountRecovered != null ? { amount_recovered: input.amountRecovered } : {}),
      ...(input.retailerRef !== undefined ? { retailer_ref: input.retailerRef || null } : {}),
      ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
      ...(stamp[input.state] ? { [stamp[input.state]]: today } : {}),
    })
    .eq("id", input.recoveryId);
  if (error) throw error;
}

/** Every recovery, joined for the operator's recovery board. */
export async function listRecoveries(): Promise<Recovery[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("recovery")
    .select(COLS)
    .order("state", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => toRecovery(r as Row));
}

/** Portfolio totals: identified vs recovered dollars. */
export async function recoveryTotals(): Promise<{ identified: number; recovered: number }> {
  const all = await listRecoveries();
  return {
    identified: all.reduce((s, r) => s + r.amountIdentified, 0),
    recovered: all.reduce((s, r) => s + (r.amountRecovered ?? 0), 0),
  };
}

export interface RecoveryWithContext extends Recovery {
  findingLabel: string;
  clientName: string;
  nmi: string;
  periodStart: string | null;
  periodEnd: string | null;
}

/** [v1.1] Every recovery, labelled (finding → run → NMI/client) for the recovery board. */
export async function listRecoveriesDetailed(): Promise<RecoveryWithContext[]> {
  const supabase = await createSupabaseServerClient();
  const recoveries = await listRecoveries();
  if (recoveries.length === 0) return [];

  const findingIds = [...new Set(recoveries.map((r) => r.findingId))];
  const clientIds = [...new Set(recoveries.map((r) => r.clientId))];

  const [fRes, cRes] = await Promise.all([
    supabase
      .from("reconciliation_finding")
      .select("id, label, reconciliation_id")
      .in("id", findingIds),
    supabase.from("client").select("id, name").in("id", clientIds),
  ]);
  if (fRes.error) throw fRes.error;
  if (cRes.error) throw cRes.error;
  const findings = (fRes.data ?? []) as { id: string; label: string; reconciliation_id: string }[];

  const runIds = [...new Set(findings.map((f) => f.reconciliation_id))];
  const { data: runData, error: runErr } = await supabase
    .from("reconciliation")
    .select("id, metering_point_id, period_start, period_end")
    .in("id", runIds);
  if (runErr) throw runErr;
  const runs = (runData ?? []) as {
    id: string;
    metering_point_id: string;
    period_start: string;
    period_end: string;
  }[];

  const mpIds = [...new Set(runs.map((r) => r.metering_point_id))];
  const { data: mpData, error: mpErr } = await supabase
    .from("metering_point")
    .select("id, nmi")
    .in("id", mpIds);
  if (mpErr) throw mpErr;

  const findingById = new Map(findings.map((f) => [f.id, f]));
  const runById = new Map(runs.map((r) => [r.id, r]));
  const nmiById = new Map(((mpData ?? []) as { id: string; nmi: string }[]).map((m) => [m.id, m.nmi]));
  const clientById = new Map(((cRes.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));

  return recoveries.map((r) => {
    const f = findingById.get(r.findingId);
    const run = f ? runById.get(f.reconciliation_id) : undefined;
    return {
      ...r,
      findingLabel: f?.label ?? "Finding",
      clientName: clientById.get(r.clientId) ?? "—",
      nmi: run ? (nmiById.get(run.metering_point_id) ?? "—") : "—",
      periodStart: run?.period_start ?? null,
      periodEnd: run?.period_end ?? null,
    };
  });
}
