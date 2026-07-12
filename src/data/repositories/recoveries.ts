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
