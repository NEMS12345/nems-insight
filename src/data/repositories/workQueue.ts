import { createSupabaseServerClient } from "@/data/supabase/server";

/**
 * [v1.1] The monthly work queue — what's outstanding this cycle, per client: batches
 * awaiting the quality gate, bills without a signed-off reconciliation, unassigned NMIs
 * (blocked from modelling), open recovery queries, and when data last arrived. This is
 * pure aggregation over workflow state; the numbers it summarises live in their own tables.
 */

export interface ClientQueue {
  pendingBatches: number;
  unsignedBills: number;
  unassignedNmis: number;
  openRecoveries: number;
  lastUploadAt: string | null;
}

export interface WorkQueue {
  byClient: Map<string, ClientQueue>;
  totals: { identified: number; recovered: number };
}

const EMPTY: ClientQueue = {
  pendingBatches: 0,
  unsignedBills: 0,
  unassignedNmis: 0,
  openRecoveries: 0,
  lastUploadAt: null,
};

export async function workQueue(): Promise<WorkQueue> {
  const supabase = await createSupabaseServerClient();
  const [batches, bills, runs, recoveries, mps, assignments] = await Promise.all([
    supabase.from("import_batch").select("client_id, review_state, uploaded_at"),
    supabase.from("bill").select("id, client_id"),
    supabase.from("reconciliation").select("bill_id, signed_at, computed_at"),
    supabase.from("recovery").select("client_id, state, amount_identified, amount_recovered"),
    supabase.from("metering_point").select("id, client_id"),
    supabase.from("tariff_assignment").select("metering_point_id"),
  ]);
  for (const r of [batches, bills, runs, recoveries, mps, assignments]) {
    if (r.error) throw r.error;
  }

  const byClient = new Map<string, ClientQueue>();
  const q = (clientId: string): ClientQueue => {
    let entry = byClient.get(clientId);
    if (!entry) {
      entry = { ...EMPTY };
      byClient.set(clientId, entry);
    }
    return entry;
  };

  for (const b of (batches.data ?? []) as {
    client_id: string;
    review_state: string;
    uploaded_at: string;
  }[]) {
    const entry = q(b.client_id);
    if (b.review_state === "pending_review") entry.pendingBatches++;
    if (!entry.lastUploadAt || b.uploaded_at > entry.lastUploadAt) {
      entry.lastUploadAt = b.uploaded_at;
    }
  }

  // A bill is outstanding until its LATEST run is signed off.
  const latestSigned = new Map<string, boolean>();
  const latestAt = new Map<string, string>();
  for (const r of (runs.data ?? []) as {
    bill_id: string;
    signed_at: string | null;
    computed_at: string;
  }[]) {
    const prev = latestAt.get(r.bill_id);
    if (!prev || r.computed_at > prev) {
      latestAt.set(r.bill_id, r.computed_at);
      latestSigned.set(r.bill_id, r.signed_at != null);
    }
  }
  for (const b of (bills.data ?? []) as { id: string; client_id: string }[]) {
    if (!latestSigned.get(b.id)) q(b.client_id).unsignedBills++;
  }

  const assignedMp = new Set(
    ((assignments.data ?? []) as { metering_point_id: string }[]).map((a) => a.metering_point_id),
  );
  for (const m of (mps.data ?? []) as { id: string; client_id: string }[]) {
    if (!assignedMp.has(m.id)) q(m.client_id).unassignedNmis++;
  }

  let identified = 0;
  let recovered = 0;
  for (const r of (recoveries.data ?? []) as {
    client_id: string;
    state: string;
    amount_identified: number | string;
    amount_recovered: number | string | null;
  }[]) {
    if (r.state !== "recovered") q(r.client_id).openRecoveries++;
    identified += Number(r.amount_identified);
    recovered += r.amount_recovered == null ? 0 : Number(r.amount_recovered);
  }

  return { byClient, totals: { identified, recovered } };
}
