export type ReconciliationStatus = "match" | "review" | "investigate";

export interface Reconciliation {
  modelledTotal: number;
  billedTotal: number;
  /** billed − modelled. Positive means the bill is higher than the model. */
  variance: number;
  /** Variance as a fraction of the modelled cost (0.05 = 5%). */
  variancePct: number;
  status: ReconciliationStatus;
}

export interface ReconcileOptions {
  /** Within this band the bill is treated as a match. Default 2%. */
  matchPct?: number;
  /** Beyond this band the discrepancy warrants investigation. Default 10%. */
  investigatePct?: number;
}

/**
 * Compare modelled cost against the billed total. This is the headline: it's how billing
 * errors surface and how "is this arrangement good or bad" gets answered.
 */
export function reconcile(
  modelledTotal: number,
  billedTotal: number,
  opts: ReconcileOptions = {},
): Reconciliation {
  const matchPct = opts.matchPct ?? 0.02;
  const investigatePct = opts.investigatePct ?? 0.1;

  const variance = billedTotal - modelledTotal;
  const variancePct = modelledTotal === 0 ? 0 : variance / modelledTotal;
  const abs = Math.abs(variancePct);

  const status: ReconciliationStatus =
    abs <= matchPct ? "match" : abs <= investigatePct ? "review" : "investigate";

  return { modelledTotal, billedTotal, variance, variancePct, status };
}
