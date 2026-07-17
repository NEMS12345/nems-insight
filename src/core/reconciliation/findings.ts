// [v1.1] Findings — the pure translation of a reconciliation result into per-line findings
// with reason codes, ready for operator triage (review → sign-off → recovery). This is the
// `(modelled, billed) → Finding[]` function of the v1.1 spec: it adds nothing to the
// comparison itself (reconcile.ts owns tolerances and judgement); it names WHY each line
// varies so the workflow layer can carry it. No DB, no auth — workflow state lives outside
// the core (CLAUDE.md §5b).

import type { ComponentKind } from "@/core/reconciliation/taxonomy";
import type {
  ComponentStatus,
  ComponentVariance,
  ReconciliationResult,
} from "@/core/reconciliation/reconcile";

/** Why a line was flagged. Mirrors the DB check constraint on reconciliation_finding. */
export type ReasonCode =
  | "overcharge" // billed exceeds modelled beyond tolerance
  | "undercharge" // billed below modelled beyond tolerance
  | "not_billed" // modelled but absent from the bill
  | "not_modelled" // on the bill but nothing modelled for it
  | "within_tolerance" // variance inside both tolerances
  | "pass_through"; // declared pass-through — reported, never a billing-error claim

export interface Finding {
  key: string;
  kind: ComponentKind;
  subKey?: string;
  label: string;
  modelledAud: number | null;
  billedAud: number | null;
  varianceAud: number; // billed − modelled (absent side treated as 0)
  variancePct: number | null;
  reasonCode: ReasonCode;
  /** The comparison's severity for this line — kept so triage can rank the queue. */
  severity: ComponentStatus;
}

function reasonFor(c: ComponentVariance): ReasonCode {
  switch (c.status) {
    case "pass-through":
      return "pass_through";
    case "unbilled":
      return "not_billed";
    case "unmodelled":
      return "not_modelled";
    case "match":
      return "within_tolerance";
    case "review":
    case "investigate":
      return c.varianceAud > 0 ? "overcharge" : "undercharge";
  }
}

/**
 * Derive triageable findings from a component-wise reconciliation result. One finding per
 * component line, ordered as the result orders them (severity first), each with a reason
 * code. Overcharge/undercharge is judged from the SIGN of variance (billed − modelled) on
 * lines that breached tolerance; sign-free states map to their own codes.
 */
export function deriveFindings(result: ReconciliationResult): Finding[] {
  return result.components.map((c) => ({
    key: c.key,
    kind: c.kind,
    subKey: c.subKey,
    label: c.label,
    modelledAud: c.modelledAud,
    billedAud: c.billedAud,
    varianceAud: c.varianceAud,
    variancePct: c.variancePct,
    reasonCode: reasonFor(c),
    severity: c.status,
  }));
}
