import { createSupabaseServerClient } from "@/data/supabase/server";
import type { Judgement } from "@/core/reconciliation";
import type { Finding, ReasonCode } from "@/core/reconciliation";

/**
 * [v1.1] Persisted reconciliation runs + findings. The pure core computes; this repository
 * records the run so it can be triaged, signed off, re-run next month, and reported on.
 * All workflow state (status, notes, sign-off) lives HERE, never in the core.
 */

export type FindingStatus =
  | "open"
  | "confirmed_error"
  | "queried"
  | "dismissed"
  | "within_tolerance";

export interface ReconciliationRun {
  id: string;
  clientId: string;
  meteringPointId: string;
  billId: string;
  periodStart: string;
  periodEnd: string;
  modelledTotal: number;
  billedTotal: number;
  judgement: Judgement;
  coverageFraction: number | null;
  estimatedFraction: number | null;
  computedAt: string;
  signedOffBy: string | null;
  signedAt: string | null;
}

export interface StoredFinding {
  id: string;
  reconciliationId: string;
  component: string;
  label: string;
  modelled: number | null;
  billed: number | null;
  variance: number;
  variancePct: number | null;
  reasonCode: ReasonCode;
  status: FindingStatus;
  operatorNote: string | null;
  recommendation: string | null;
}

interface RunRow {
  id: string;
  client_id: string;
  metering_point_id: string;
  bill_id: string;
  period_start: string;
  period_end: string;
  modelled_total: number | string;
  billed_total: number | string;
  judgement: Judgement;
  coverage_fraction: number | string | null;
  estimated_fraction: number | string | null;
  computed_at: string;
  signed_off_by: string | null;
  signed_at: string | null;
}

interface FindingRow {
  id: string;
  reconciliation_id: string;
  component: string;
  label: string;
  modelled: number | string | null;
  billed: number | string | null;
  variance: number | string;
  variance_pct: number | string | null;
  reason_code: ReasonCode;
  status: FindingStatus;
  operator_note: string | null;
  recommendation: string | null;
}

const RUN_COLS =
  "id, client_id, metering_point_id, bill_id, period_start, period_end, modelled_total, billed_total, judgement, coverage_fraction, estimated_fraction, computed_at, signed_off_by, signed_at";
const FINDING_COLS =
  "id, reconciliation_id, component, label, modelled, billed, variance, variance_pct, reason_code, status, operator_note, recommendation";

const num = (v: number | string | null): number | null => (v == null ? null : Number(v));

function toRun(r: RunRow): ReconciliationRun {
  return {
    id: r.id,
    clientId: r.client_id,
    meteringPointId: r.metering_point_id,
    billId: r.bill_id,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    modelledTotal: Number(r.modelled_total),
    billedTotal: Number(r.billed_total),
    judgement: r.judgement,
    coverageFraction: num(r.coverage_fraction),
    estimatedFraction: num(r.estimated_fraction),
    computedAt: r.computed_at,
    signedOffBy: r.signed_off_by,
    signedAt: r.signed_at,
  };
}

function toFinding(r: FindingRow): StoredFinding {
  return {
    id: r.id,
    reconciliationId: r.reconciliation_id,
    component: r.component,
    label: r.label,
    modelled: num(r.modelled),
    billed: num(r.billed),
    variance: Number(r.variance),
    variancePct: num(r.variance_pct),
    reasonCode: r.reason_code,
    status: r.status,
    operatorNote: r.operator_note,
    recommendation: r.recommendation,
  };
}

export interface NewRun {
  clientId: string;
  meteringPointId: string;
  billId: string;
  periodStart: string;
  periodEnd: string;
  modelledTotal: number;
  billedTotal: number;
  judgement: Judgement;
  coverageFraction?: number;
  estimatedFraction?: number;
  findings: Finding[];
}

/**
 * Persist a run and its findings. Prior runs for the bill are kept as history; the latest
 * run is the current one. Line-level statuses default to open, except lines the engine
 * already cleared (within_tolerance / pass_through), which arrive pre-triaged.
 */
export async function saveRun(input: NewRun): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("reconciliation")
    .insert({
      client_id: input.clientId,
      metering_point_id: input.meteringPointId,
      bill_id: input.billId,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      modelled_total: input.modelledTotal,
      billed_total: input.billedTotal,
      judgement: input.judgement,
      coverage_fraction: input.coverageFraction ?? null,
      estimated_fraction: input.estimatedFraction ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  const runId = (data as { id: string }).id;

  if (input.findings.length > 0) {
    const { error: fErr } = await supabase.from("reconciliation_finding").insert(
      input.findings.map((f) => ({
        client_id: input.clientId,
        reconciliation_id: runId,
        component: f.key,
        label: f.label,
        modelled: f.modelledAud,
        billed: f.billedAud,
        variance: f.varianceAud,
        variance_pct: f.variancePct,
        reason_code: f.reasonCode,
        status:
          f.reasonCode === "within_tolerance" || f.reasonCode === "pass_through"
            ? "within_tolerance"
            : "open",
      })),
    );
    if (fErr) throw fErr;
  }
  return runId;
}

/** Latest run per bill for a metering point, with findings. */
export async function latestRunsForMeteringPoint(
  meteringPointId: string,
): Promise<Array<ReconciliationRun & { findings: StoredFinding[] }>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("reconciliation")
    .select(RUN_COLS)
    .eq("metering_point_id", meteringPointId)
    .order("computed_at", { ascending: false });
  if (error) throw error;
  const runs = (data ?? []).map((r) => toRun(r as RunRow));
  const latestPerBill = new Map<string, ReconciliationRun>();
  for (const run of runs) if (!latestPerBill.has(run.billId)) latestPerBill.set(run.billId, run);
  const current = [...latestPerBill.values()];
  if (current.length === 0) return [];

  const { data: fData, error: fErr } = await supabase
    .from("reconciliation_finding")
    .select(FINDING_COLS)
    .in("reconciliation_id", current.map((r) => r.id));
  if (fErr) throw fErr;
  const findings = ((fData ?? []) as FindingRow[]).map(toFinding);
  return current.map((run) => ({
    ...run,
    findings: findings.filter((f) => f.reconciliationId === run.id),
  }));
}

export interface RunWithContext extends ReconciliationRun {
  findings: StoredFinding[];
  nmi: string;
  clientName: string;
  retailer: string | null;
}

/** [v1.1] Latest run per bill across the whole portfolio, labelled for the review queue. */
export async function listAllLatestRuns(): Promise<RunWithContext[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("reconciliation")
    .select(RUN_COLS)
    .order("computed_at", { ascending: false });
  if (error) throw error;
  const runs = (data ?? []).map((r) => toRun(r as RunRow));
  const latestPerBill = new Map<string, ReconciliationRun>();
  for (const run of runs) if (!latestPerBill.has(run.billId)) latestPerBill.set(run.billId, run);
  const current = [...latestPerBill.values()];
  if (current.length === 0) return [];

  const runIds = current.map((r) => r.id);
  const mpIds = [...new Set(current.map((r) => r.meteringPointId))];
  const clientIds = [...new Set(current.map((r) => r.clientId))];
  const billIds = [...new Set(current.map((r) => r.billId))];

  const [fRes, mpRes, cRes, bRes] = await Promise.all([
    supabase.from("reconciliation_finding").select(FINDING_COLS).in("reconciliation_id", runIds),
    supabase.from("metering_point").select("id, nmi").in("id", mpIds),
    supabase.from("client").select("id, name").in("id", clientIds),
    supabase.from("bill").select("id, retailer").in("id", billIds),
  ]);
  for (const r of [fRes, mpRes, cRes, bRes]) if (r.error) throw r.error;

  const findings = ((fRes.data ?? []) as FindingRow[]).map(toFinding);
  const nmi = new Map(((mpRes.data ?? []) as { id: string; nmi: string }[]).map((m) => [m.id, m.nmi]));
  const cname = new Map(((cRes.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  const retailer = new Map(
    ((bRes.data ?? []) as { id: string; retailer: string | null }[]).map((b) => [b.id, b.retailer]),
  );

  return current
    .map((run) => ({
      ...run,
      findings: findings.filter((f) => f.reconciliationId === run.id),
      nmi: nmi.get(run.meteringPointId) ?? "—",
      clientName: cname.get(run.clientId) ?? "—",
      retailer: retailer.get(run.billId) ?? null,
    }))
    .sort((a, b) => (a.signedAt ? 1 : 0) - (b.signedAt ? 1 : 0) || b.computedAt.localeCompare(a.computedAt));
}

/** Triage one finding: set its status, note and client-facing recommendation. */
export async function triageFinding(input: {
  findingId: string;
  status: FindingStatus;
  operatorNote?: string;
  recommendation?: string;
}): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("reconciliation_finding")
    .update({
      status: input.status,
      operator_note: input.operatorNote ?? null,
      recommendation: input.recommendation ?? null,
    })
    .eq("id", input.findingId);
  if (error) throw error;
}

/** Sign off a run (no finding may still be open) as the given operator. */
export async function signOffRun(runId: string, userId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("reconciliation_finding")
    .select("id")
    .eq("reconciliation_id", runId)
    .eq("status", "open")
    .limit(1);
  if (error) throw error;
  if ((data ?? []).length > 0) throw new Error("Cannot sign off: findings still open.");
  const { error: uErr } = await supabase
    .from("reconciliation")
    .update({ signed_off_by: userId, signed_at: new Date().toISOString() })
    .eq("id", runId);
  if (uErr) throw uErr;
}

/** Re-open a signed-off run (it runs again next month; everything is re-openable). */
export async function reopenRun(runId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("reconciliation")
    .update({ signed_off_by: null, signed_at: null })
    .eq("id", runId);
  if (error) throw error;
}
