// Component-wise reconciliation (Layer 2 — pure core). Compares a MODELLED cost breakdown
// against the DECLARED (billed) one component by component to surface billing errors, while
// excluding declared pass-through charges and downgrading confidence on estimated data.
//
// This is the headline feature's engine-facing half: it operates on component breakdowns
// (fixtures here; the cost-engine output + operator-entered bill in Phase 4) and does no I/O.

export * from "@/core/reconciliation/taxonomy";
export * from "@/core/reconciliation/reconcile";
export * from "@/core/reconciliation/map";
